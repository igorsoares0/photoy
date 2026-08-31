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
  const suite = createSuite('inpainting');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-inpaint-'));

  const open = async (file) => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, file) });
    const history = await engine.call('edit.history', { documentId: result.id });
    return { id: result.id, ...history.result };
  };

  /** Adds the layer that draws a fill, masked by what marked the object. */
  const addPatchLayer = async (document, filled, raster) => {
    await engine.call('edit.apply', {
      documentId: document.id,
      operation: { kind: 'addLayer', layerKind: 'patch', name: 'Remoção' },
    });
    const { result: history } = await engine.call('edit.history', { documentId: document.id });
    const layerId = history.layers.at(-1).id;
    await engine.call('edit.apply', {
      documentId: document.id,
      operation: {
        kind: 'setLayerPatch', layerId, patch: filled.patch,
        patchWidth: filled.documentWidth, patchHeight: filled.documentHeight,
      },
    });
    await engine.call('edit.apply', {
      documentId: document.id,
      operation: {
        kind: 'setLayerMask', layerId,
        mask: {
          kind: 'raster', raster,
          rasterWidth: filled.documentWidth, rasterHeight: filled.documentHeight,
        },
      },
    });
    return layerId;
  };

  /** Marks a rectangle, in fractions of the frame, and stores it. */
  const mark = async (documentId, width, height, box) => {
    const mask = Buffer.alloc(width * height);
    if (box !== null) {
      const x0 = Math.round(width * box.x);
      const x1 = Math.round(width * (box.x + box.width));
      for (let y = Math.round(height * box.y); y < Math.round(height * (box.y + box.height)); y += 1) {
        mask.fill(255, y * width + x0, y * width + x1);
      }
    }
    const { result } = await engine.call('mask.store', { documentId, width, height }, undefined, mask);
    return result.raster;
  };

  await suite.check('describe reports the inpainting model and its licence', async () => {
    // The licence is shipping constraint rather than trivia, so it travels with
    // the model rather than living in a comment somewhere.
    const { result } = await engine.call('engine.describe');
    assert.ok(result.operations !== undefined);
    const model = result.models.find((entry) => entry.id === 'inpainting');
    assert.ok(model !== undefined, 'the inpainting model is not in the catalogue');
    assert.equal(model.license, 'Apache-2.0');
  });

  await suite.check('a mask that marks nothing is refused clearly', async () => {
    // Filling nothing would burn four seconds of inference to return the
    // picture unchanged.
    const document = await open('large.png');
    const raster = await mark(document.id, 256, 177, null);
    await assert.rejects(
      engine.call('ai.inpaint', { documentId: document.id, raster }),
      /Nothing is marked/,
    );
    await engine.call('image.close', { documentId: document.id });
  });

  await suite.check('a mask that was never stored is refused clearly', async () => {
    const document = await open('large.png');
    await assert.rejects(
      engine.call('ai.inpaint', { documentId: document.id, raster: 4242 }),
      /No such mask/,
    );
    await engine.call('image.close', { documentId: document.id });
  });

  await suite.check('the window surrounds the mark and stays inside the frame', async () => {
    // The model sees a fixed 512, so the whole question is which part of the
    // photograph to spend it on: enough context to extrapolate from, and never
    // a pixel that does not exist.
    const document = await open('large.png');
    const raster = await mark(document.id, 512, 354, { x: 0.4, y: 0.4, width: 0.12, height: 0.12 });
    const { result } = await engine.call('ai.inpaint', { documentId: document.id, raster });

    assert.ok(result.x >= 0 && result.y >= 0, `window at ${result.x},${result.y}`);
    assert.ok(result.x + result.width <= document.naturalWidth);
    assert.ok(result.y + result.height <= document.naturalHeight);

    const markLeft = document.naturalWidth * 0.4;
    const markRight = document.naturalWidth * 0.52;
    assert.ok(result.x < markLeft && result.x + result.width > markRight, 'the mark is not inside');
    // Context, not a tight crop: a window cut to the mark leaves the model
    // nothing to extrapolate from.
    assert.ok(result.width > markRight - markLeft, 'the window has no margin around the mark');
    await engine.call('image.close', { documentId: document.id });
  });

  await suite.check('a patch layer paints the fill into the picture', async () => {
    // The whole path: the model invents pixels, they are kept beside the
    // document, and a layer draws them through the mask that marked the object.
    const document = await open('large.png');
    const raster = await mark(document.id, 512, 354, { x: 0.4, y: 0.4, width: 0.12, height: 0.12 });
    const filled = await engine.call('ai.inpaint', { documentId: document.id, raster });
    assert.ok(filled.result.patch > 0, 'the patch was not kept');

    const before = await engine.call('image.renderPreview', {
      documentId: document.id, maxWidth: 700, maxHeight: 700,
    });
    const layerId = await addPatchLayer(document, filled.result, raster);
    const after = await engine.call('image.renderPreview', {
      documentId: document.id, maxWidth: 700, maxHeight: 700,
    });
    assert.ok(layerId > 0);

    const { width, height, stride } = before.result;
    const middle = (frame) => pixelAt(frame, stride, Math.floor(width * 0.46), Math.floor(height * 0.46));
    const corner = (frame) => pixelAt(frame, stride, Math.floor(width * 0.05), Math.floor(height * 0.05));
    assert.notDeepEqual(middle(after.payload), middle(before.payload), 'the mark was not filled');
    assert.deepEqual(corner(after.payload), corner(before.payload), 'the photograph was touched');
    await engine.call('image.close', { documentId: document.id });
  });

  await suite.check('hiding the patch layer brings the object back', async () => {
    const document = await open('large.png');
    const raster = await mark(document.id, 512, 354, { x: 0.4, y: 0.4, width: 0.12, height: 0.12 });
    const before = await engine.call('image.renderPreview', {
      documentId: document.id, maxWidth: 700, maxHeight: 700,
    });
    const filled = await engine.call('ai.inpaint', { documentId: document.id, raster });
    const layerId = await addPatchLayer(document, filled.result, raster);

    await engine.call('edit.apply', {
      documentId: document.id,
      operation: { kind: 'setLayerVisible', layerId, visible: false },
    });
    const hidden = await engine.call('image.renderPreview', {
      documentId: document.id, maxWidth: 700, maxHeight: 700,
    });
    const at = (frame) =>
      pixelAt(frame, before.result.stride, Math.floor(before.result.width * 0.46),
              Math.floor(before.result.height * 0.46));
    assert.deepEqual(at(hidden.payload), at(before.payload), 'the original did not come back');
    await engine.call('image.close', { documentId: document.id });
  });

  await suite.check('a filled object survives a project round trip', async () => {
    // The patch is pixels, so it has to travel inside the container the way a
    // painted mask does; without that, saving would quietly undo the removal.
    const document = await open('large.png');
    const raster = await mark(document.id, 512, 354, { x: 0.4, y: 0.4, width: 0.12, height: 0.12 });
    const filled = await engine.call('ai.inpaint', { documentId: document.id, raster });
    await addPatchLayer(document, filled.result, raster);
    const expected = await engine.call('image.renderPreview', {
      documentId: document.id, maxWidth: 700, maxHeight: 700,
    });

    const target = path.join(workDir, 'filled.myphoto');
    await engine.call('project.save', { documentId: document.id, path: target });
    await engine.call('image.close', { documentId: document.id });

    const opened = await engine.call('project.open', { path: target });
    const layer = opened.result.history.layers.find((entry) => entry.kind === 'patch');
    assert.ok(layer !== undefined, 'the patch layer was lost');
    assert.ok(layer.patch > 0, 'the patch identifier was lost');
    const back = await engine.call('image.renderPreview', {
      documentId: opened.result.id, maxWidth: 700, maxHeight: 700,
    });
    const at = (frame) =>
      pixelAt(frame, expected.result.stride, Math.floor(expected.result.width * 0.46),
              Math.floor(expected.result.height * 0.46));
    assert.deepEqual(at(back.payload), at(expected.payload), 'the fill came back different');
    await engine.call('image.close', { documentId: opened.result.id });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
