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

  /**
   * Walks up the middle of the frame from the centre and returns the first
   * partly covered pixel, which is the only place a mixture exists.
   *
   * Found rather than hardcoded: the transition sits beyond the radius, and the
   * radius is in units of the shorter side, so where it lands on screen depends
   * on the shape of the fixture.
   */
  const findEdge = (at) => {
    for (let step = 50; step >= 0; step -= 1) {
      const pixel = at(0.5, step / 100);
      if (pixel[3] > 40 && pixel[3] < 215) return { pixel, y: step / 100 };
    }
    return null;
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
    assert.deepEqual(result.layerKinds, ['background', 'adjustment', 'matte', 'patch']);
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

  await suite.check('describe reports the levels and the decontamination', async () => {
    const { result } = await engine.call('engine.describe');
    assert.ok(result.operations.includes('setLayerDecontaminate'));
    const documentId = await open();
    const layerId = await addMatte(documentId);
    const { result: history } = await engine.call('edit.history', { documentId });
    const layer = history.layers.find((entry) => entry.id === layerId);
    assert.equal(layer.decontaminate, 1);
    assert.equal(layer.mask.low, 0);
    assert.equal(layer.mask.high, 1);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a black point on the mask discards what it was unsure of', async () => {
    // A radial mask is a ramp, so its midway values stand in for exactly the
    // low-confidence pixels a segmentation model leaves around a subject.
    const documentId = await open();
    const layerId = await addMatte(documentId, { ...CENTRE_MASK, feather: 0.3 });
    const edge = findEdge(await read(documentId));
    assert.ok(edge !== null, 'no soft edge to test');

    await apply(documentId, {
      kind: 'setLayerMask',
      layerId,
      mask: { ...CENTRE_MASK, feather: 0.3, low: (edge.pixel[3] + 12) / 255, high: 1 },
    });
    const after = await read(documentId);
    assert.equal(after(0.5, edge.y)[3], 0, 'the black point should have cut it');
    assert.equal(after(0.5, 0.5)[3], 255, 'the middle should be untouched');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a white point below the black point is a hard threshold', async () => {
    // The slope is division by (high - low), so this is where a NaN would live.
    const documentId = await open();
    const layerId = await addMatte(documentId, { ...CENTRE_MASK, feather: 0.3 });
    await apply(documentId, {
      kind: 'setLayerMask',
      layerId,
      mask: { ...CENTRE_MASK, feather: 0.3, low: 0.5, high: 0.5 },
    });
    const after = await read(documentId);
    for (const alpha of [after(0.5, 0.5)[3], after(0.5, 0.30)[3], after(0.03, 0.05)[3]]) {
      assert.ok(alpha === 0 || alpha === 255, `expected a hard edge, got ${alpha}`);
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('decontamination leaves the fully covered photograph alone', async () => {
    // The interior is not a mixture of anything, so unmixing must not touch it.
    const documentId = await open('subject.png');
    const layerId = await addMatte(documentId, { ...CENTRE_MASK, radius: 0.3, feather: 0.15 });
    await apply(documentId, { kind: 'setLayerDecontaminate', layerId, decontaminate: 0 });
    const off = await read(documentId);
    await apply(documentId, { kind: 'setLayerDecontaminate', layerId, decontaminate: 1 });
    const on = await read(documentId);

    assert.equal(off(0.5, 0.5)[3], 255, 'the middle should be fully covered');
    assert.deepEqual(on(0.5, 0.5), off(0.5, 0.5), 'the interior was modified');
    await engine.call('image.close', { documentId });
  });

  await suite.check('decontamination pulls the old background out of the edge', async () => {
    // A dark subject on a white ground: every edge pixel is lighter than the
    // subject only because the ground bled into it.
    const documentId = await open('subject.png');
    const layerId = await addMatte(documentId, { ...CENTRE_MASK, radius: 0.3, feather: 0.15 });
    await apply(documentId, { kind: 'setLayerDecontaminate', layerId, decontaminate: 0 });

    const found = findEdge(await read(documentId));
    assert.ok(found !== null, 'no partly covered pixel to test');
    const before = found.pixel;
    await apply(documentId, { kind: 'setLayerDecontaminate', layerId, decontaminate: 1 });
    const after = (await read(documentId))(0.5, found.y);

    const luminance = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    assert.ok(
      luminance(after) < luminance(before),
      `the white ground should have come out: ${luminance(before).toFixed(0)} -> ${luminance(after).toFixed(0)}`,
    );
    assert.equal(after[3], before[3], 'decontamination must not move the coverage');
    await engine.call('image.close', { documentId });
  });

  await suite.check('the levels and the decontamination survive a round trip', async () => {
    const documentId = await open();
    const layerId = await addMatte(documentId, { ...CENTRE_MASK, low: 0.2, high: 0.8 });
    await apply(documentId, { kind: 'setLayerDecontaminate', layerId, decontaminate: 0.4 });

    const target = path.join(workDir, 'levels.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    const layer = opened.result.history.layers.find((entry) => entry.kind === 'matte');
    assert.ok(Math.abs(layer.mask.low - 0.2) < 1e-5, `low was ${layer.mask.low}`);
    assert.ok(Math.abs(layer.mask.high - 0.8) < 1e-5, `high was ${layer.mask.high}`);
    assert.ok(Math.abs(layer.decontaminate - 0.4) < 1e-5, `decontaminate was ${layer.decontaminate}`);
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
