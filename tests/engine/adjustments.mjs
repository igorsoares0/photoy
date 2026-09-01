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

  /** Opens any fixture, for the checks that want flat or coloured ground. */
  const openFile = async (file) => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, file) });
    return result.id;
  };

  /** Renders at full size and reads by fraction of the frame. */
  const sample = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    const { width, height, stride } = preview.result;
    return (fx, fy) =>
      pixelAt(preview.payload, stride, Math.floor(fx * (width - 1)), Math.floor(fy * (height - 1)));
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

  await suite.check('a hue rotation leaves greys exactly grey', async () => {
    // The rotation is about the neutral axis, so this is the property that
    // makes it a hue control rather than a colour cast.
    const documentId = await openFile('flat.png');
    const before = await sample(documentId);
    const grey = before(0.5, 0.5);
    assert.equal(grey[0], grey[1]);

    await adjust(documentId, { hue: 90 });
    const after = (await sample(documentId))(0.5, 0.5);
    assert.ok(Math.abs(after[0] - after[1]) <= 1 && Math.abs(after[1] - after[2]) <= 1,
              `grey turned into ${after}`);
    assert.ok(Math.abs(after[0] - grey[0]) <= 1, `grey changed brightness: ${grey} -> ${after}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a hue rotation moves a colour and keeps its brightness', async () => {
    // Measured in linear light, because that is where luminance is preserved -
    // the preview is sRGB-encoded and weighting those values directly would be
    // measuring the curve rather than the rotation.
    //
    // The sample is the muted patch on purpose. A fully saturated primary sits
    // on the sRGB gamut boundary, so rotating it lands outside and the 8-bit
    // preview clips; that changes luminance for reasons that have nothing to do
    // with this matrix.
    const documentId = await openFile('patches.png');
    const before = await sample(documentId);
    const decode = (v) => {
      const e = v / 255;
      return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
    };
    const luma = (p) => 0.2126 * decode(p[0]) + 0.7152 * decode(p[1]) + 0.0722 * decode(p[2]);
    const original = before(0.92, 0.5);

    await adjust(documentId, { hue: 60 });
    const after = (await sample(documentId))(0.92, 0.5);
    assert.notDeepEqual(after.slice(0, 3), original.slice(0, 3), 'the colour did not move');
    assert.ok(Math.abs(luma(after) - luma(original)) / luma(original) < 0.03,
              `brightness moved: ${luma(original).toFixed(4)} -> ${luma(after).toFixed(4)}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('half a turn is the same either way round', async () => {
    // A real invariant of a rotation, and the one that catches a sign or a
    // normalisation gone wrong. Each adjust replaces the last rather than
    // composing with it, so this compares two documents, not two steps.
    const first = await openFile('patches.png');
    await adjust(first, { hue: 180 });
    const clockwise = (await sample(first))(0.08, 0.5);

    const second = await openFile('patches.png');
    await adjust(second, { hue: -180 });
    const anticlockwise = (await sample(second))(0.08, 0.5);

    for (let c = 0; c < 3; c += 1) {
      assert.ok(Math.abs(clockwise[c] - anticlockwise[c]) <= 2,
                `${clockwise} against ${anticlockwise}`);
    }
    await engine.call('image.close', { documentId: first });
    await engine.call('image.close', { documentId: second });
  });

  await suite.check('vibrance spends itself on the flattest colours', async () => {
    // The whole difference from saturation: a colour that is already vivid
    // should barely move while a muted one moves a lot.
    const documentId = await openFile('patches.png');
    const before = await sample(documentId);
    const chroma = (p) => Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]);

    const samples = [];
    for (let i = 0; i < 6; i += 1) samples.push(before((i + 0.5) / 6, 0.5));
    samples.sort((a, b) => chroma(a) - chroma(b));
    const flattest = samples[0];
    const most = samples.at(-1);
    assert.ok(chroma(most) > chroma(flattest) + 20, 'the fixture has no contrast in chroma');

    await adjust(documentId, { vibrance: 80 });
    const after = await sample(documentId);
    const movedFlat = [];
    const movedVivid = [];
    for (let i = 0; i < 6; i += 1) {
      const was = before((i + 0.5) / 6, 0.5);
      const now = after((i + 0.5) / 6, 0.5);
      (chroma(was) < chroma(most) / 2 ? movedFlat : movedVivid).push(chroma(now) - chroma(was));
    }
    const mean = (values) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    assert.ok(mean(movedFlat) > mean(movedVivid),
              `flat moved ${mean(movedFlat).toFixed(1)}, vivid moved ${mean(movedVivid).toFixed(1)}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a vignette darkens the corners and leaves the middle', async () => {
    const documentId = await openFile('flat.png');
    const before = await sample(documentId);
    await adjust(documentId, { vignette: -80 });
    const after = await sample(documentId);

    assert.ok(after(0.02, 0.04)[0] < before(0.02, 0.04)[0] - 20, 'the corner did not darken');
    assert.ok(Math.abs(after(0.5, 0.5)[0] - before(0.5, 0.5)[0]) <= 1, 'the middle moved');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a positive vignette lightens instead', async () => {
    const documentId = await openFile('flat.png');
    const before = await sample(documentId);
    await adjust(documentId, { vignette: 80 });
    assert.ok((await sample(documentId))(0.02, 0.04)[0] > before(0.02, 0.04)[0] + 10);
    await engine.call('image.close', { documentId });
  });

  await suite.check('grain varies pixel to pixel and repeats exactly', async () => {
    // Deterministic, because a render that differs from the one before it would
    // make every comparison in this product a lie.
    const documentId = await openFile('flat.png');
    await adjust(documentId, { grain: 100 });
    const first = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    const second = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    assert.ok(first.payload.equals(second.payload), 'the same render came out different');

    const values = new Set();
    for (let x = 0; x < 60; x += 1) {
      values.add(pixelAt(first.payload, first.result.stride, x, 100)[0]);
    }
    assert.ok(values.size > 5, `grain produced only ${values.size} distinct values`);
    await engine.call('image.close', { documentId });
  });

  // patches.png is nine flat bands twenty pixels wide, so it has hard edges to
  // sharpen and flat interiors that must not move. alpha.png cannot serve here:
  // its colour is constant and only its alpha varies, so there is no luminance
  // detail in it at all and every check against it would pass by doing nothing.
  const pixels = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    return (x, y = PATCH_SIZE / 2) => pixelAt(preview.payload, preview.result.stride, x, y);
  };
  /** The boundary between the light and the grey band, and their interiors. */
  const EDGE = INDEX.grey * PATCH_SIZE;

  await suite.check('sharpening raises contrast across an edge', async () => {
    const documentId = await openFile('patches.png');
    const before = await pixels(documentId);
    const gap = (at) => at(EDGE - 3)[0] - at(EDGE + 3)[0];
    const was = gap(before);
    assert.ok(was > 20, `the fixture has no edge here: ${was}`);

    await adjust(documentId, { sharpen: 100 });
    const now = gap(await pixels(documentId));
    assert.ok(now > was, `the edge did not sharpen: ${was} -> ${now}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('sharpening leaves a flat interior alone', async () => {
    const documentId = await openFile('patches.png');
    const before = await pixels(documentId);
    const middle = EDGE + PATCH_SIZE / 2;
    await adjust(documentId, { sharpen: 100 });
    const after = await pixels(documentId);
    assert.ok(Math.abs(after(middle)[0] - before(middle)[0]) <= 1,
              `a flat band moved: ${before(middle)} -> ${after(middle)}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('sharpening a flat picture changes nothing at all', async () => {
    // There is no detail to raise. This is the check that catches a blur whose
    // window does not clamp against the border.
    const documentId = await openFile('flat.png');
    const before = await sample(documentId);
    await adjust(documentId, { sharpen: 100 });
    const after = await sample(documentId);
    for (const [fx, fy] of [[0.5, 0.5], [0.01, 0.01], [0.99, 0.99], [0.5, 0.02]]) {
      assert.deepEqual(after(fx, fy), before(fx, fy), `moved at ${fx},${fy}`);
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('clarity is neutral on a flat picture too', async () => {
    const documentId = await openFile('flat.png');
    const before = await sample(documentId);
    await adjust(documentId, { clarity: 100 });
    assert.deepEqual((await sample(documentId))(0.5, 0.5), before(0.5, 0.5));
    await engine.call('image.close', { documentId });
  });

  await suite.check('clarity pushes the light and the dark apart', async () => {
    // Local contrast at a large radius: a band lighter than its surroundings
    // gets lighter still, and a darker one gets darker.
    const documentId = await openFile('patches.png');
    const before = await pixels(documentId);
    const light = INDEX.light * PATCH_SIZE + PATCH_SIZE / 2;
    const dark = INDEX.dark * PATCH_SIZE + PATCH_SIZE / 2;

    await adjust(documentId, { clarity: 100 });
    const after = await pixels(documentId);
    assert.ok(after(light)[0] > before(light)[0], `light band: ${before(light)[0]} -> ${after(light)[0]}`);
    assert.ok(after(dark)[0] < before(dark)[0], `dark band: ${before(dark)[0]} -> ${after(dark)[0]}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('negative clarity flattens instead', async () => {
    const documentId = await openFile('patches.png');
    const before = await pixels(documentId);
    const light = INDEX.light * PATCH_SIZE + PATCH_SIZE / 2;
    await adjust(documentId, { clarity: -100 });
    assert.ok((await pixels(documentId))(light)[0] < before(light)[0]);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a mask confines sharpening to where it applies', async () => {
    // The spatial pass runs over a buffer rather than per pixel, so it is its
    // own opportunity to forget the mask.
    const documentId = await openFile('patches.png');
    const before = await pixels(documentId);
    await engine.call('edit.apply', {
      documentId, operation: { kind: 'addLayer', name: 'Nitidez' },
    });
    const { result: history } = await engine.call('edit.history', { documentId });
    const layerId = history.layers.at(-1).id;
    await engine.call('edit.apply', {
      documentId,
      operation: {
        kind: 'setLayerMask', layerId,
        mask: { kind: 'radial', x: 0.85, y: 0.5, radius: 0.2, feather: 0.05 },
      },
    });
    await engine.call('edit.apply', {
      documentId, operation: { kind: 'adjust', layerId, adjustments: { sharpen: 100 } },
    });

    const after = await pixels(documentId);
    const gap = (at) => at(EDGE - 3)[0] - at(EDGE + 3)[0];
    assert.equal(gap(after), gap(before), 'sharpening escaped its mask');
    await engine.call('image.close', { documentId });
  });

  await suite.check('an export carries the sharpening', async () => {
    const documentId = await openFile('patches.png');
    const plain = await openFile('patches.png');
    await adjust(documentId, { sharpen: 100 });
    const target = path.join(workDir, 'sharp.png');
    await engine.call('image.export', { documentId, path: target, format: 'png' });

    const { result: reopened } = await engine.call('image.open', { path: target });
    const gap = (at) => at(EDGE - 3)[0] - at(EDGE + 3)[0];
    assert.ok(gap(await pixels(reopened.id)) > gap(await pixels(plain)),
              'the export came out unsharpened');
    await engine.call('image.close', { documentId: reopened.id });
    await engine.call('image.close', { documentId: plain });
    await engine.call('image.close', { documentId });
  });

  await suite.check('the analysis measures the document as it looks now', async () => {
    // It measures the picture on screen, not the file: running it after an edit
    // has to see the edit, or the second proposal would repeat the first.
    const documentId = await openFile('flat.png');
    const plain = await engine.call('image.analyse', { documentId });
    assert.equal(plain.result.histogram.length, 256);
    assert.ok(plain.result.pixels > 0);
    const middle = plain.result.histogram.findIndex((count) => count > 0);

    await adjust(documentId, { exposure: 1.5 });
    const brighter = await engine.call('image.analyse', { documentId });
    const moved = brighter.result.histogram.findIndex((count) => count > 0);
    assert.ok(moved > middle, `the histogram did not move: ${middle} then ${moved}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('the analysis reports a colour cast it can see', async () => {
    const documentId = await openFile('patches.png');
    const neutral = await engine.call('image.analyse', { documentId });
    const spread = (m) => Math.max(...m) - Math.min(...m);
    assert.ok(spread(neutral.result.channelMean) < 0.05, 'the fixture is not neutral');

    await adjust(documentId, { temperature: 80 });
    const warm = await engine.call('image.analyse', { documentId });
    assert.ok(warm.result.channelMean[0] > warm.result.channelMean[2], 'warming did not show');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a flat frame measures no detail and a busy one does', async () => {
    const flat = await openFile('flat.png');
    const busy = await openFile('patches.png');
    const flatDetail = (await engine.call('image.analyse', { documentId: flat })).result.detail;
    const busyDetail = (await engine.call('image.analyse', { documentId: busy })).result.detail;
    assert.ok(flatDetail < 0.001, `a flat frame measured ${flatDetail}`);
    assert.ok(busyDetail > flatDetail, 'bands of colour measured no more detail than a flat frame');
    await engine.call('image.close', { documentId: flat });
    await engine.call('image.close', { documentId: busy });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
