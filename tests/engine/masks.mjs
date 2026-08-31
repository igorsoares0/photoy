import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite, pixelAt } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('masks');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-masks-'));

  // A flat grey field, so any variation across the frame is the mask and
  // nothing else.
  const open = async () => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, 'flat.png') });
    return result.id;
  };
  const apply = (documentId, operation) => engine.call('edit.apply', { documentId, operation });

  /** Renders and reads one row across the frame. */
  const scanline = async (documentId, maxWidth = 4000) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth, maxHeight: maxWidth,
    });
    const { width, height, stride } = preview.result;
    const y = Math.floor(height / 2);
    const at = (fraction) =>
      pixelAt(preview.payload, stride, Math.floor(fraction * (width - 1)), y)[0];
    return { at, width, height, column: (fx, fy) =>
      pixelAt(preview.payload, stride, Math.floor(fx * (width - 1)), Math.floor(fy * (height - 1)))[0] };
  };

  /** A brightening layer, so the mask shows as a light-to-dark difference. */
  const brighten = async (documentId, mask) => {
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1.2 } });
    const { result } = await engine.call('edit.history', { documentId });
    const layerId = result.layers[1].id;
    if (mask !== undefined) await apply(documentId, { kind: 'setLayerMask', layerId, mask });
    return layerId;
  };

  await suite.check('describe lists the mask kinds it understands', async () => {
    const { result } = await engine.call('engine.describe');
    assert.deepEqual(result.maskKinds, ['none', 'linear', 'radial', 'raster']);
    assert.ok(result.operations.includes('setLayerMask'));
  });

  await suite.check('a layer with no mask applies everywhere', async () => {
    const documentId = await open();
    const plain = (await scanline(documentId)).at(0.5);
    await brighten(documentId);
    const lit = await scanline(documentId);
    for (const fraction of [0.05, 0.5, 0.95]) {
      assert.ok(lit.at(fraction) > plain + 20, `nothing happened at ${fraction}`);
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('a linear mask divides the frame along its angle', async () => {
    const documentId = await open();
    const plain = (await scanline(documentId)).at(0.5);
    // Angle pi/2 points across the frame, so the transition runs left to right.
    await brighten(documentId, {
      kind: 'linear', x: 0.5, y: 0.5, angle: Math.PI / 2, feather: 0.05,
    });
    const lit = await scanline(documentId);

    assert.ok(Math.abs(lit.at(0.05) - plain) <= 2, 'the masked-out side moved');
    assert.ok(lit.at(0.95) > plain + 20, 'the applied side did not');
    // The midpoint sits halfway through the transition.
    assert.ok(
      lit.at(0.5) > plain + 5 && lit.at(0.5) < lit.at(0.95) - 5,
      `the midpoint should be partway: ${plain}, ${lit.at(0.5)}, ${lit.at(0.95)}`,
    );
    await engine.call('image.close', { documentId });
  });

  await suite.check('the feather is a gradient, not a step', async () => {
    const documentId = await open();
    await brighten(documentId, {
      kind: 'linear', x: 0.5, y: 0.5, angle: Math.PI / 2, feather: 1.5,
    });
    const lit = await scanline(documentId);
    const samples = [0.2, 0.35, 0.5, 0.65, 0.8].map((f) => lit.at(f));
    for (let i = 1; i < samples.length; i += 1) {
      assert.ok(samples[i] > samples[i - 1], `not monotonic: ${samples.join(', ')}`);
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('inverting swaps which side is affected', async () => {
    const documentId = await open();
    const plain = (await scanline(documentId)).at(0.5);
    const layerId = await brighten(documentId, {
      kind: 'linear', x: 0.5, y: 0.5, angle: Math.PI / 2, feather: 0.05,
    });
    await apply(documentId, {
      kind: 'setLayerMask',
      layerId,
      mask: { kind: 'linear', x: 0.5, y: 0.5, angle: Math.PI / 2, feather: 0.05, invert: true },
    });
    const lit = await scanline(documentId);
    assert.ok(lit.at(0.05) > plain + 20, 'the left should now be lit');
    assert.ok(Math.abs(lit.at(0.95) - plain) <= 2, 'the right should now be untouched');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a radial mask stays a circle on a frame that is not square', async () => {
    const documentId = await open();
    const plain = (await scanline(documentId)).at(0.5);
    await brighten(documentId, { kind: 'radial', x: 0.5, y: 0.5, radius: 0.3, feather: 0.02 });
    const lit = await scanline(documentId);

    assert.ok(lit.column(0.5, 0.5) > plain + 20, 'the centre should be lit');
    // The fixture is twice as wide as it is tall. A radius of 0.3 short sides
    // reaches 30% of the way up but only 15% of the way across, so the corners
    // of the frame stay clear on both axes.
    assert.ok(Math.abs(lit.column(0.02, 0.5) - plain) <= 2, 'the left edge was reached');
    assert.ok(Math.abs(lit.column(0.5, 0.02) - plain) <= 2, 'the top edge was reached');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a mask means the same thing at any resolution', async () => {
    // Masks are fractions of the document, not pixels, so a preview and a full
    // render have to agree without anything being resampled between them.
    const documentId = await open();
    await brighten(documentId, {
      kind: 'linear', x: 0.5, y: 0.5, angle: Math.PI / 2, feather: 0.6,
    });
    const full = await scanline(documentId, 4000);
    const small = await scanline(documentId, 60);
    for (const fraction of [0.15, 0.5, 0.85]) {
      assert.ok(
        Math.abs(full.at(fraction) - small.at(fraction)) <= 4,
        `at ${fraction}: full ${full.at(fraction)}, small ${small.at(fraction)}`,
      );
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('an export applies the mask the preview showed', async () => {
    const documentId = await open();
    await brighten(documentId, {
      kind: 'linear', x: 0.5, y: 0.5, angle: Math.PI / 2, feather: 0.05,
    });
    const expected = await scanline(documentId);

    const target = path.join(workDir, 'masked.png');
    await engine.call('image.export', { documentId, path: target, format: 'png' });
    const reopened = await engine.call('image.open', { path: target });
    const actual = await scanline(reopened.result.id);

    for (const fraction of [0.05, 0.5, 0.95]) {
      assert.ok(
        Math.abs(actual.at(fraction) - expected.at(fraction)) <= 2,
        `at ${fraction}: preview ${expected.at(fraction)}, export ${actual.at(fraction)}`,
      );
    }
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId });
  });

  await suite.check('a mask survives a save and reopen', async () => {
    const documentId = await open();
    await brighten(documentId, {
      kind: 'radial', x: 0.4, y: 0.6, radius: 0.25, feather: 0.1, invert: true,
    });
    const expected = await scanline(documentId);

    const target = path.join(workDir, 'masked.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    const mask = opened.result.history.layers[1].mask;
    assert.equal(mask.kind, 'radial');
    assert.equal(mask.invert, true);
    assert.ok(Math.abs(mask.x - 0.4) < 1e-5 && Math.abs(mask.radius - 0.25) < 1e-5);

    const actual = await scanline(opened.result.id);
    for (const fraction of [0.2, 0.5, 0.8]) {
      assert.equal(actual.at(fraction), expected.at(fraction), `drifted at ${fraction}`);
    }
    await engine.call('image.close', { documentId: opened.result.id });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
