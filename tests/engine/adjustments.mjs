import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite, pixelAt } from './harness.mjs';
import { PATCHES, PATCH_SIZE } from '../fixtures/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

const INDEX = Object.fromEntries(PATCHES.map((patch, i) => [patch.name, i]));

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('adjustments');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-adjust-'));

  const open = async () => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, 'patches.png') });
    return result.id;
  };

  /** Renders at full size and returns the centre pixel of each named patch. */
  const patches = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId,
      maxWidth: 4000,
      maxHeight: 4000,
    });
    const read = (name) =>
      pixelAt(
        preview.payload,
        preview.result.stride,
        INDEX[name] * PATCH_SIZE + PATCH_SIZE / 2,
        PATCH_SIZE / 2,
      );
    return { read, result: preview.result };
  };

  const adjust = (documentId, adjustments, replaceTop = false) =>
    engine.call('edit.apply', {
      documentId,
      operation: { kind: 'adjust', adjustments },
      replaceTop,
    });

  await suite.check('describe lists adjust among the operations', async () => {
    const { result } = await engine.call('engine.describe');
    assert.ok(result.operations.includes('adjust'));
  });

  await suite.check('neutral adjustments change nothing', async () => {
    const documentId = await open();
    const before = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    await adjust(documentId, { exposure: 0, contrast: 0 });
    const after = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    assert.deepEqual(after.payload, before.payload);
    await engine.call('image.close', { documentId });
  });

  await suite.check('exposure moves light by the stops it says it does', async () => {
    // A stop is a factor of two in linear light, so the result is not a matter
    // of taste: mid grey has one arithmetically correct answer.
    const expected = (srgb, stops) => {
      const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
      return Math.round(toSrgb(Math.min(1, toLinear(srgb / 255) * 2 ** stops)) * 255);
    };

    for (const stops of [1, -1, 0.5]) {
      const documentId = await open();
      await adjust(documentId, { exposure: stops });
      const { read } = await patches(documentId);
      for (const name of ['grey', 'dark', 'light']) {
        const target = expected(PATCHES[INDEX[name]].rgb[0], stops);
        const actual = read(name)[0];
        assert.ok(
          Math.abs(actual - target) <= 2,
          `${name} at ${stops} EV: expected ~${target}, read ${actual}`,
        );
      }
      await engine.call('image.close', { documentId });
    }
  });

  await suite.check('saturation at -100 leaves only grey', async () => {
    const documentId = await open();
    await adjust(documentId, { saturation: -100 });
    const { read } = await patches(documentId);
    for (const name of ['red', 'green', 'blue']) {
      const [r, g, b] = read(name);
      assert.ok(
        Math.abs(r - g) <= 2 && Math.abs(g - b) <= 2,
        `${name} still has colour: ${r},${g},${b}`,
      );
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('saturation at +100 pushes colour further out', async () => {
    // Measured on a patch inside the gamut: a primary is already on the corner
    // of sRGB and has nowhere further to go once it is written out.
    const documentId = await open();
    const plain = (await patches(documentId)).read('muted');
    await adjust(documentId, { saturation: 100 });
    const boosted = (await patches(documentId)).read('muted');
    const spread = (p) => Math.max(...p.slice(0, 3)) - Math.min(...p.slice(0, 3));
    assert.ok(
      spread(boosted) > spread(plain) + 10,
      `channels should separate: ${plain.slice(0, 3)} -> ${boosted.slice(0, 3)}`,
    );
    await engine.call('image.close', { documentId });
  });

  await suite.check('contrast pulls the ends apart and leaves mid grey alone', async () => {
    const documentId = await open();
    const before = (await patches(documentId)).read;
    const dark = before('dark')[0];
    const light = before('light')[0];
    const grey = before('grey')[0];

    await adjust(documentId, { contrast: 80 });
    const after = (await patches(documentId)).read;
    assert.ok(after('dark')[0] < dark - 4, 'dark tones should go down');
    assert.ok(after('light')[0] > light + 4, 'light tones should go up');
    assert.ok(Math.abs(after('grey')[0] - grey) <= 3, 'mid grey is the pivot');
    await engine.call('image.close', { documentId });
  });

  await suite.check('highlights act on the top end and leave the bottom', async () => {
    const documentId = await open();
    const before = (await patches(documentId)).read;
    const white = before('white')[0];
    const dark = before('dark')[0];

    await adjust(documentId, { highlights: -100 });
    const after = (await patches(documentId)).read;
    assert.ok(after('white')[0] < white - 20, 'white should come down');
    assert.ok(Math.abs(after('dark')[0] - dark) <= 3, 'dark tones should not move');
    await engine.call('image.close', { documentId });
  });

  await suite.check('shadows lift the dark tones without greying the blacks', async () => {
    const documentId = await open();
    const before = (await patches(documentId)).read;
    const dark = before('dark')[0];
    const white = before('white')[0];

    await adjust(documentId, { shadows: 100 });
    const after = (await patches(documentId)).read;
    assert.ok(after('dark')[0] > dark + 10, 'dark tones should open up');
    assert.ok(after('black')[0] <= 6, 'absolute black should stay black');
    assert.ok(Math.abs(after('white')[0] - white) <= 3, 'white should not move');
    await engine.call('image.close', { documentId });
  });

  await suite.check('temperature warms and cools', async () => {
    const documentId = await open();
    const neutral = (await patches(documentId)).read('grey');

    await adjust(documentId, { temperature: 60 });
    const warm = (await patches(documentId)).read('grey');
    assert.ok(warm[0] > neutral[0], 'warming should raise red');
    assert.ok(warm[2] < neutral[2], 'warming should lower blue');

    await adjust(documentId, { temperature: -60 }, true);
    const cool = (await patches(documentId)).read('grey');
    assert.ok(cool[0] < neutral[0], 'cooling should lower red');
    assert.ok(cool[2] > neutral[2], 'cooling should raise blue');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a dragged slider leaves one history entry, not one per frame', async () => {
    const documentId = await open();
    await adjust(documentId, { exposure: 0.1 });
    for (let i = 2; i <= 20; i += 1) await adjust(documentId, { exposure: i / 10 }, true);

    const { result } = await engine.call('edit.history', { documentId });
    assert.equal(result.entries.length, 1, 'the gesture should collapse to one step');
    assert.ok(Math.abs(result.adjustments.exposure - 2) < 1e-5);

    const undone = await engine.call('edit.undo', { documentId });
    assert.equal(undone.result.adjustments.exposure, 0, 'undo should drop the whole gesture');
    await engine.call('image.close', { documentId });
  });

  await suite.check('the cached geometry does not serve stale colour', async () => {
    // Successive renders at the same size reuse the geometry result. The colour
    // half must still be redone, or a moving slider would show nothing.
    const documentId = await open();
    await adjust(documentId, { exposure: 1 });
    const bright = (await patches(documentId)).read('grey')[0];
    await adjust(documentId, { exposure: -1 }, true);
    const dim = (await patches(documentId)).read('grey')[0];
    assert.ok(bright > dim + 40, `expected a clear difference, got ${bright} and ${dim}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a geometry change invalidates the cached base', async () => {
    const documentId = await open();
    await adjust(documentId, { exposure: 0.5 });
    await engine.call('image.renderPreview', { documentId, maxWidth: 4000, maxHeight: 4000 });

    const rotated = await engine.call('edit.apply', {
      documentId,
      operation: { kind: 'rotate', quarters: 1 },
    });
    assert.equal(rotated.result.width, PATCH_SIZE);

    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    assert.equal(preview.result.width, PATCH_SIZE);
    assert.equal(preview.result.height, PATCHES.length * PATCH_SIZE);
    await engine.call('image.close', { documentId });
  });

  await suite.check('an export carries the adjustments', async () => {
    const documentId = await open();
    await adjust(documentId, { exposure: 1 });
    const expected = (await patches(documentId)).read('grey');

    const target = path.join(workDir, 'adjusted.png');
    await engine.call('image.export', { documentId, path: target, format: 'png' });

    const reopened = await engine.call('image.open', { path: target });
    const { read } = await patches(reopened.result.id);
    const actual = read('grey');
    actual.forEach((value, index) => {
      assert.ok(
        Math.abs(value - expected[index]) <= 2,
        `channel ${index}: preview ${expected[index]}, export ${value}`,
      );
    });
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
