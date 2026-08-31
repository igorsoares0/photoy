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

/** A radial mask over the middle, so the corners are unambiguously outside. */
const CENTRE_MASK = { kind: 'radial', x: 0.5, y: 0.5, radius: 0.2, feather: 0.02 };

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('background removal');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-bg-'));

  const open = async (file = 'flat.png') => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, file) });
    return result.id;
  };
  const apply = (documentId, operation) => engine.call('edit.apply', { documentId, operation });

  const read = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    const { width, height, stride } = preview.result;
    return (fx, fy) =>
      pixelAt(preview.payload, stride, Math.floor(fx * (width - 1)), Math.floor(fy * (height - 1)));
  };

  /** Adds a matte layer carrying the given mask, and returns its id. */
  const addMatte = async (documentId, mask = CENTRE_MASK) => {
    await apply(documentId, { kind: 'addLayer', layerKind: 'matte', name: 'Fundo' });
    const { result } = await engine.call('edit.history', { documentId });
    const layer = result.layers[result.layers.length - 1];
    assert.equal(layer.kind, 'matte');
    await apply(documentId, { kind: 'setLayerMask', layerId: layer.id, mask });
    return layer.id;
  };

  await suite.check('describe reports the layer and fill kinds', async () => {
    const { result } = await engine.call('engine.describe');
    assert.deepEqual(result.layerKinds, ['background', 'adjustment', 'matte']);
    assert.deepEqual(result.fillKinds, ['transparent', 'color']);
    assert.ok(result.operations.includes('setLayerFill'));
  });

  await suite.check('a matte without a mask leaves the photograph alone', async () => {
    // Nothing marked means nothing to remove; the layer has to be a no-op
    // rather than erasing the whole frame.
    const documentId = await open();
    const before = await read(documentId);
    const corner = before(0.05, 0.05);
    await apply(documentId, { kind: 'addLayer', layerKind: 'matte', name: 'Fundo' });
    const after = await read(documentId);
    assert.deepEqual(after(0.05, 0.05), corner);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a matte makes everything outside its mask transparent', async () => {
    const documentId = await open();
    await addMatte(documentId);
    const after = await read(documentId);

    assert.equal(after(0.5, 0.5)[3], 255, 'the subject should stay opaque');
    assert.equal(after(0.03, 0.05)[3], 0, 'the corner should be gone');
    // The colour under the transparency is untouched: this removes, it does not
    // paint.
    assert.deepEqual(after(0.5, 0.5).slice(0, 3), (await read(documentId))(0.5, 0.5).slice(0, 3));
    await engine.call('image.close', { documentId });
  });

  await suite.check('a colour fill replaces the background and stays opaque', async () => {
    const documentId = await open();
    const layerId = await addMatte(documentId);
    await apply(documentId, {
      kind: 'setLayerFill',
      layerId,
      fill: 'color',
      color: { r: 1, g: 0, b: 0 },
    });
    const after = await read(documentId);

    const corner = after(0.03, 0.05);
    assert.equal(corner[3], 255, 'a filled background is opaque');
    assert.ok(corner[0] > 240 && corner[1] < 15 && corner[2] < 15, `expected red, got ${corner}`);
    assert.equal(after(0.5, 0.5)[3], 255);
    assert.ok(after(0.5, 0.5)[0] < 200, 'the subject should not have been painted over');
    await engine.call('image.close', { documentId });
  });

  await suite.check('hiding the matte brings the background back', async () => {
    const documentId = await open();
    const before = await read(documentId);
    const corner = before(0.03, 0.05);
    const layerId = await addMatte(documentId);
    assert.equal((await read(documentId))(0.03, 0.05)[3], 0);

    await apply(documentId, { kind: 'setLayerVisible', layerId, visible: false });
    assert.deepEqual((await read(documentId))(0.03, 0.05), corner);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a PNG export keeps the transparency', async () => {
    const documentId = await open();
    await addMatte(documentId);

    const target = path.join(workDir, 'cut-out.png');
    await engine.call('image.export', { documentId, path: target, format: 'png' });
    const reopened = await engine.call('image.open', { path: target });
    const back = await read(reopened.result.id);

    assert.equal(back(0.03, 0.05)[3], 0, 'the export filled the transparency in');
    assert.equal(back(0.5, 0.5)[3], 255);
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId });
  });

  await suite.check('a JPEG export composites onto white rather than dropping alpha', async () => {
    // JPEG has no alpha. Letting the encoder discard it would quietly bring the
    // removed background back, which is worse than any visible failure.
    const documentId = await open();
    const before = await read(documentId);
    const originalCorner = before(0.03, 0.05)[0];
    await addMatte(documentId);

    const target = path.join(workDir, 'cut-out.jpg');
    await engine.call('image.export', { documentId, path: target, format: 'jpeg', quality: 95 });
    const reopened = await engine.call('image.open', { path: target });
    const back = await read(reopened.result.id);

    const corner = back(0.03, 0.05);
    assert.ok(corner[0] > 245, `expected white, got ${corner} (original was ${originalCorner})`);
    assert.notEqual(corner[0], originalCorner, 'the original background survived');
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId });
  });

  await suite.check('a removed background survives a save and reopen', async () => {
    const documentId = await open();
    const layerId = await addMatte(documentId);
    await apply(documentId, {
      kind: 'setLayerFill',
      layerId,
      fill: 'color',
      color: { r: 0, g: 0.5, b: 1 },
    });
    const expected = (await read(documentId))(0.03, 0.05);

    const target = path.join(workDir, 'matte.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    const layer = opened.result.history.layers.find((entry) => entry.kind === 'matte');
    assert.ok(layer !== undefined, 'the matte layer was lost');
    assert.equal(layer.fill, 'color');
    assert.deepEqual((await read(opened.result.id))(0.03, 0.05), expected);
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('segmentation and a matte remove the background together', async () => {
    const documentId = await open('subject.png');
    const segmented = await engine.call('ai.segment', { documentId });
    const layerId = await addMatte(documentId, {
      kind: 'raster',
      raster: segmented.result.raster,
      rasterWidth: segmented.result.width,
      rasterHeight: segmented.result.height,
    });
    assert.ok(layerId > 0);

    const after = await read(documentId);
    assert.equal(after(0.46, 0.33)[3], 255, 'the subject should have survived');
    assert.ok(after(0.06, 0.1)[3] < 40, `the background should be gone: ${after(0.06, 0.1)}`);
    await engine.call('image.close', { documentId });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
