import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('image pipeline');
  const check = suite.check.bind(suite);
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-smoke-'));

  await check('engine.describe reports the protocol and its codecs', async () => {
    const { result } = await engine.call('engine.describe');
    assert.equal(result.protocolVersion, 1);
    for (const format of ['jpeg', 'png', 'tiff', 'webp']) {
      assert.ok(result.decodeFormats.includes(format), `cannot decode ${format}`);
      assert.ok(result.encodeFormats.includes(format), `cannot encode ${format}`);
    }
  });

  let documentId;
  await check('image.open decodes a PNG and reports its geometry', async () => {
    const { result } = await engine.call('image.open', {
      path: path.join(fixtures, 'gradient.png'),
    });
    documentId = result.id;
    assert.equal(result.image.width, 200);
    assert.equal(result.image.height, 120);
    assert.equal(result.image.format, 'png');
    assert.equal(result.image.orientation, 1);
  });

  await check('image.open rejects a path that does not exist', async () => {
    await assert.rejects(
      () => engine.call('image.open', { path: path.join(fixtures, 'missing.png') }),
      /file_not_found/,
    );
  });

  await check('renderPreview returns full resolution when the box is larger', async () => {
    const { result, payload } = await engine.call('image.renderPreview', {
      documentId,
      maxWidth: 4000,
      maxHeight: 4000,
    });
    assert.equal(result.width, 200);
    assert.equal(result.height, 120);
    assert.equal(result.scale, 1);
    assert.equal(payload.length, 200 * 120 * 4);
  });

  await check('renderPreview downscales to fit and keeps the aspect ratio', async () => {
    const { result, payload } = await engine.call('image.renderPreview', {
      documentId,
      maxWidth: 100,
      maxHeight: 100,
    });
    assert.equal(result.width, 100);
    assert.equal(result.height, 60);
    assert.ok(Math.abs(result.scale - 0.5) < 1e-9);
    assert.equal(payload.length, result.stride * result.height);
  });

  await check('preview pixels keep RGBA channel order', async () => {
    const { payload, result } = await engine.call('image.renderPreview', {
      documentId,
      maxWidth: 200,
      maxHeight: 120,
    });
    // The fixture paints a solid magenta block at x 40-89, y 20-59.
    const offset = 40 * result.stride + 60 * 4;
    assert.deepEqual([...payload.subarray(offset, offset + 4)], [255, 0, 255, 255]);
  });

  for (const [format, extension] of [
    ['jpeg', 'jpg'],
    ['png', 'png'],
    ['tiff', 'tif'],
    ['webp', 'webp'],
  ]) {
    await check(`export to ${format} writes a file the engine can read back`, async () => {
      const target = path.join(workDir, `out.${extension}`);
      const { result } = await engine.call('image.export', {
        documentId,
        path: target,
        format,
        quality: 92,
      });
      assert.equal(result.format, format);
      assert.ok(statSync(target).size > 0, 'exported file is empty');
      assert.equal(result.bytesWritten, statSync(target).size);

      const reopened = await engine.call('image.open', { path: target });
      assert.equal(reopened.result.image.format, format);
      assert.equal(reopened.result.image.width, 200);
      assert.equal(reopened.result.image.height, 120);
      await engine.call('image.close', { documentId: reopened.result.id });
    });
  }

  await check('export refuses a format it cannot encode', async () => {
    await assert.rejects(
      () => engine.call('image.export', {
        documentId,
        path: path.join(workDir, 'out.bmp'),
        format: 'bmp',
      }),
      /unsupported_format/,
    );
  });

  await check('transparency survives a downscale without colour bleed', async () => {
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'alpha.png') });
    assert.equal(opened.result.image.hasAlpha, true);
    const { result, payload } = await engine.call('image.renderPreview', {
      documentId: opened.result.id,
      maxWidth: 50,
      maxHeight: 30,
    });
    // Left half is opaque orange, right half fully transparent.
    const row = 15 * result.stride;
    assert.equal(payload[row + 5 * 4 + 3], 255, 'left half should stay opaque');
    assert.equal(payload[row + 44 * 4 + 3], 0, 'right half should stay transparent');
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await check('an unknown method fails without taking the engine down', async () => {
    await assert.rejects(() => engine.call('image.levitate', {}), /invalid_request/);
    const { result } = await engine.call('engine.describe');
    assert.equal(result.name, 'photoy-engine');
  });

  await check('image.close releases the document', async () => {
    const { result } = await engine.call('image.close', { documentId });
    assert.equal(result.closed, true);
    await assert.rejects(
      () => engine.call('image.renderPreview', { documentId, maxWidth: 10, maxHeight: 10 }),
      /document_not_found/,
    );
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
