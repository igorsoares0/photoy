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
  const suite = createSuite('resize');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-resize-'));

  const open = async (file) => {
    const { result } = await engine.call('image.open', {
      path: path.isAbsolute(file) ? file : path.join(fixtures, file),
    });
    return result;
  };
  const apply = (documentId, operation) => engine.call('edit.apply', { documentId, operation });
  const size = async (documentId) => {
    const { result } = await engine.call('edit.history', { documentId });
    return { width: result.width, height: result.height };
  };

  await suite.check('describe lists resize', async () => {
    const { result } = await engine.call('engine.describe');
    assert.ok(result.operations.includes('resize'));
  });

  await suite.check('an enlargement reconstructs detail rather than blurring it', async () => {
    // The claim the filter is chosen for, tested the way it was measured: take
    // the answer key apart and put it back. A reduction to a quarter and an
    // enlargement back cannot recover what was thrown away, but how much of the
    // detail survives is exactly what separates a windowed sinc from a linear
    // blend - measured at 7.2 against bilinear's 5.0 on this fixture.
    //
    // The reduction is written to a file rather than stacked, because the stack
    // folds resizes into one target size and would otherwise compare the
    // photograph against itself and pass no matter what.
    const opened = await open('patches.png');
    const { result: original } = await engine.call('edit.history', { documentId: opened.id });
    await apply(opened.id, {
      kind: 'resize',
      width: Math.round(original.width / 4),
      height: Math.round(original.height / 4),
    });
    const reduced = path.join(workDir, 'reduced.png');
    await engine.call('image.export', { documentId: opened.id, path: reduced, format: 'png' });
    await engine.call('image.close', { documentId: opened.id });

    const back = await open(reduced);
    await apply(back.id, { kind: 'resize', width: original.width, height: original.height });
    const { result: info, payload } = await engine.call('image.renderPreview', {
      documentId: back.id, maxWidth: original.width, maxHeight: original.height,
    });

    let energy = 0;
    let count = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 1; x < info.width; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          const at = y * info.stride + x * 4 + c;
          energy += Math.abs(payload[at] - payload[at - 4]);
          count += 1;
        }
      }
    }
    const recovered = energy / count;
    assert.ok(recovered > 6, `only ${recovered.toFixed(3)} of detail recovered, which is a blur`);
    await engine.call('image.close', { documentId: back.id });
  });

  await suite.check('an enlargement leaves a flat region flat', async () => {
    // The kernel's weights do not sum to one on their own, and forgetting to
    // normalise them shows up here as banding across something uniform.
    const opened = await open('flat.png');
    const { result: history } = await engine.call('edit.history', { documentId: opened.id });
    await apply(opened.id, {
      kind: 'resize', width: history.width * 3, height: history.height * 3,
    });
    const { result: info, payload } = await engine.call('image.renderPreview', {
      documentId: opened.id, maxWidth: history.width * 3, maxHeight: history.height * 3,
    });

    const centre = pixelAt(payload, info.stride, Math.round(info.width / 2), Math.round(info.height / 2));
    for (let x = 4; x < info.width - 4; x += 7) {
      const here = pixelAt(payload, info.stride, x, Math.round(info.height / 2));
      assert.deepEqual(here, centre, `banding at x=${x}`);
    }
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a resize changes the document size', async () => {
    // gradient.png is 200 x 120.
    const opened = await open('gradient.png');
    assert.deepEqual(await size(opened.id), { width: 200, height: 120 });
    await apply(opened.id, { kind: 'resize', width: 100, height: 60 });
    assert.deepEqual(await size(opened.id), { width: 100, height: 60 });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('undoing a resize restores the size', async () => {
    // The point of doing this in the stack rather than to the pixels.
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 50, height: 30 });
    await engine.call('edit.undo', { documentId: opened.id });
    assert.deepEqual(await size(opened.id), { width: 200, height: 120 });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('an export comes out at the resized size', async () => {
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 80, height: 48 });

    const target = path.join(workDir, 'smaller.png');
    await engine.call('image.export', { documentId: opened.id, path: target, format: 'png' });
    const back = await open(target);
    assert.deepEqual(await size(back.id), { width: 80, height: 48 });
    await engine.call('image.close', { documentId: back.id });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('enlarging interpolates rather than repeating pixels', async () => {
    // A box filter cannot enlarge: every target pixel would average a single
    // source pixel, which is nearest-neighbour. A gradient is a poor test of
    // that, because at eight bits the interpolated steps quantise back onto
    // repeats anyway. A hard edge is unambiguous: alpha.png is opaque up to the
    // halfway column and transparent after it, so any value strictly between
    // the two can only have come from interpolation.
    const opened = await open('alpha.png');
    await apply(opened.id, { kind: 'resize', width: 400, height: 240 });
    const { result, payload } = await engine.call('image.renderPreview', {
      documentId: opened.id, maxWidth: 4000, maxHeight: 4000,
    });
    assert.equal(result.width, 400);

    let intermediate = 0;
    for (let x = 0; x < result.width; x += 1) {
      const alpha = pixelAt(payload, result.stride, x, 120)[3];
      if (alpha > 5 && alpha < 250) intermediate += 1;
    }
    assert.ok(intermediate > 0, 'the edge stayed hard, so nothing was interpolated');
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a quarter turn carries the resized size round with it', async () => {
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 100, height: 60 });
    await apply(opened.id, { kind: 'rotate', quarters: 1 });
    assert.deepEqual(await size(opened.id), { width: 60, height: 100 });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a flip leaves the resized size alone', async () => {
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 100, height: 60 });
    await apply(opened.id, { kind: 'flipHorizontal' });
    assert.deepEqual(await size(opened.id), { width: 100, height: 60 });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a crop after a resize keeps the scale it was given', async () => {
    // Cropping takes a smaller piece of the picture; it must not change how big
    // a pixel is. The crop is expressed against what the user sees, which is
    // the resized document.
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 100, height: 60 });
    await apply(opened.id, { kind: 'crop', rect: { x: 25, y: 15, width: 50, height: 30 } });
    assert.deepEqual(await size(opened.id), { width: 50, height: 30 });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a resize after a crop applies to what the crop left', async () => {
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'crop', rect: { x: 0, y: 0, width: 100, height: 60 } });
    await apply(opened.id, { kind: 'resize', width: 400, height: 240 });
    assert.deepEqual(await size(opened.id), { width: 400, height: 240 });
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a resize does not throw away a segmentation mask', async () => {
    // The mask is tied to the crop and the orientation, not to the output size:
    // a resize scales every pixel together, so it still means what it meant.
    // Getting this wrong makes a removed background silently come back.
    const opened = await open('subject.png');
    const seg = await engine.call('ai.segment', { documentId: opened.id });
    await apply(opened.id, { kind: 'addLayer', layerKind: 'matte', name: 'Fundo' });
    const { result: before } = await engine.call('edit.history', { documentId: opened.id });
    const layerId = before.layers.at(-1).id;
    await apply(opened.id, {
      kind: 'setLayerMask',
      layerId,
      mask: {
        kind: 'raster', raster: seg.result.raster,
        rasterWidth: seg.result.width, rasterHeight: seg.result.height,
      },
    });

    const cornerAlpha = async () => {
      const preview = await engine.call('image.renderPreview', {
        documentId: opened.id, maxWidth: 4000, maxHeight: 4000,
      });
      return pixelAt(preview.payload, preview.result.stride, 6, 6)[3];
    };
    assert.ok((await cornerAlpha()) < 60, 'the background should be gone to begin with');

    await apply(opened.id, { kind: 'resize', width: 300, height: 300 });
    assert.ok(
      (await cornerAlpha()) < 60,
      'the resize brought the removed background back',
    );
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a crop does throw away a segmentation mask', async () => {
    // The other half of the same rule: a crop really does move the pixels under
    // the mask, and stretching it to fit would be quietly wrong.
    const opened = await open('subject.png');
    const seg = await engine.call('ai.segment', { documentId: opened.id });
    const { result: sized } = await engine.call('edit.history', { documentId: opened.id });
    await apply(opened.id, {
      kind: 'crop',
      rect: { x: 10, y: 10, width: sized.width - 20, height: sized.height - 20 },
    });
    const { result } = await engine.call('edit.history', { documentId: opened.id });
    assert.notEqual(result.naturalWidth, seg.result.width);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a resize survives a project round trip', async () => {
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 133, height: 77 });

    const target = path.join(workDir, 'resized.myphoto');
    await engine.call('project.save', { documentId: opened.id, path: target });
    await engine.call('image.close', { documentId: opened.id });

    const reopened = await engine.call('project.open', { path: target });
    assert.deepEqual(await size(reopened.result.id), { width: 133, height: 77 });
    await engine.call('image.close', { documentId: reopened.result.id });
  });

  await suite.check('an absurd size is clamped rather than allocated', async () => {
    const opened = await open('gradient.png');
    await apply(opened.id, { kind: 'resize', width: 999999, height: 999999 });
    const { width, height } = await size(opened.id);
    assert.equal(width, 30000);
    assert.equal(height, 30000);
    await engine.call('image.close', { documentId: opened.id });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
