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
  const suite = createSuite('painted masks');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-brush-'));

  const open = async (file = 'flat.png') => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, file) });
    return result.id;
  };

  /** A mask that covers the left half, the way a stroke down the edge would. */
  const halfMask = (width, height) => {
    const bytes = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) bytes.fill(255, y * width, y * width + (width >> 1));
    return bytes;
  };

  await suite.check('a painted mask can be stored and read back', async () => {
    const documentId = await open();
    const bytes = halfMask(64, 32);
    const stored = await engine.call('mask.store', { documentId, width: 64, height: 32 }, undefined, bytes);
    assert.ok(stored.result.raster > 0);
    assert.equal(stored.result.width, 64);

    const back = await engine.call('mask.fetch', { documentId, raster: stored.result.raster });
    assert.equal(back.result.width, 64);
    assert.equal(back.result.height, 32);
    assert.ok(back.payload.equals(bytes), 'the mask came back different from how it went in');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a payload that does not match its stated size is refused', async () => {
    // Trusting the header here would read the rows at the wrong offsets and
    // shear the mask, which is the kind of failure nobody would attribute to
    // the brush.
    const documentId = await open();
    await assert.rejects(
      engine.call('mask.store', { documentId, width: 64, height: 32 }, undefined, Buffer.alloc(100)),
      /does not match/,
    );
    await engine.call('image.close', { documentId });
  });

  await suite.check('a mask that was never stored is refused clearly', async () => {
    const documentId = await open();
    await assert.rejects(engine.call('mask.fetch', { documentId, raster: 999 }), /No such mask/);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a painted mask drives a layer like any other', async () => {
    const documentId = await open();
    const bytes = halfMask(64, 32);
    const stored = await engine.call('mask.store', { documentId, width: 64, height: 32 }, undefined, bytes);

    await engine.call('edit.apply', {
      documentId,
      operation: { kind: 'addLayer', layerKind: 'matte', name: 'Pincel' },
    });
    const { result: history } = await engine.call('edit.history', { documentId });
    const layerId = history.layers.at(-1).id;
    await engine.call('edit.apply', {
      documentId,
      operation: {
        kind: 'setLayerMask',
        layerId,
        mask: {
          kind: 'raster', raster: stored.result.raster,
          rasterWidth: history.naturalWidth, rasterHeight: history.naturalHeight,
        },
      },
    });

    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    const { width, height, stride } = preview.result;
    const left = pixelAt(preview.payload, stride, Math.floor(width * 0.1), height >> 1);
    const right = pixelAt(preview.payload, stride, Math.floor(width * 0.9), height >> 1);
    assert.equal(left[3], 255, 'the painted half should have stayed');
    assert.equal(right[3], 0, 'the unpainted half should have gone');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a painted mask travels inside the project', async () => {
    const documentId = await open();
    const stored = await engine.call(
      'mask.store', { documentId, width: 64, height: 32 }, undefined, halfMask(64, 32),
    );
    await engine.call('edit.apply', {
      documentId, operation: { kind: 'addLayer', layerKind: 'matte', name: 'Pincel' },
    });
    const { result: history } = await engine.call('edit.history', { documentId });
    const layerId = history.layers.at(-1).id;
    await engine.call('edit.apply', {
      documentId,
      operation: {
        kind: 'setLayerMask', layerId,
        mask: {
          kind: 'raster', raster: stored.result.raster,
          rasterWidth: history.naturalWidth, rasterHeight: history.naturalHeight,
        },
      },
    });

    const target = path.join(workDir, 'painted.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    const layer = opened.result.history.layers.find((entry) => entry.kind === 'matte');
    assert.ok(layer !== undefined && layer.mask.kind === 'raster', 'the painted mask was lost');
    const back = await engine.call('mask.fetch', {
      documentId: opened.result.id, raster: layer.mask.raster,
    });
    assert.equal(back.result.width, 64);
    await engine.call('image.close', { documentId: opened.result.id });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
