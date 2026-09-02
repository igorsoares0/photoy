import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');
/**
 * Real camera files, which are not in the repository.
 *
 * The embedded-preview path cannot be exercised without one: a hand-written DNG
 * carries no preview, because writing one would mean writing the thing under
 * test. So these checks skip rather than pretend, and say so when they do.
 */
const samples = path.join(root, '.tooling', 'raw-samples');

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('thumbnails');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-thumbs-'));

  const thumbnail = (file, maxSide = 256) =>
    engine.call('image.thumbnail', { path: file, maxSide });

  await suite.check('a thumbnail fits the box and keeps the shape', async () => {
    const { result } = await thumbnail(path.join(fixtures, 'gradient.png'), 64);
    assert.ok(result.width <= 64 && result.height <= 64, `${result.width}x${result.height}`);
    assert.equal(result.width, 64, 'the long side should reach the box');
    // 200x120 reduced to fit 64: the shape survives to within a rounded pixel.
    assert.ok(Math.abs(result.height - Math.round((64 * 120) / 200)) <= 1);
    assert.equal(result.sourceWidth, 200);
    assert.equal(result.sourceHeight, 120);
  });

  await suite.check('the bytes are a JPEG the engine can read back', async () => {
    const { result, payload } = await thumbnail(path.join(fixtures, 'patches.png'), 128);
    assert.equal(payload[0], 0xff, 'not a JPEG');
    assert.equal(payload[1], 0xd8, 'not a JPEG');
    assert.equal(payload.length, result.byteLength);

    // Read back rather than trusted: the marker only says it starts like a
    // JPEG, and a truncated one starts like a JPEG too.
    const target = path.join(workDir, 'thumb.jpg');
    writeFileSync(target, payload);
    const opened = await engine.call('image.open', { path: target });
    assert.equal(opened.result.image.width, result.width);
    assert.equal(opened.result.image.height, result.height);
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('a picture smaller than the box is not enlarged', async () => {
    const { result } = await thumbnail(path.join(fixtures, 'patches.png'), 1024);
    assert.equal(result.width, 180);
    assert.equal(result.height, 20);
  });

  await suite.check('the box is clamped to something a thumbnail can be', async () => {
    const { result } = await thumbnail(path.join(fixtures, 'large.png'), 100000);
    assert.ok(result.width <= 1024, `asked for 100000, got ${result.width}`);
  });

  await suite.check('a file that is not there is refused, not invented', async () => {
    await assert.rejects(
      () => thumbnail(path.join(fixtures, 'nothing-here.png')),
      /file_not_found/,
    );
  });

  await suite.check('a thumbnail leaves no document open', async () => {
    // Browsing a folder must not put the folder in memory. There is no way to
    // ask the engine how many documents it holds, so the check is the one that
    // matters in practice: the answer carries no document to close.
    const { result } = await thumbnail(path.join(fixtures, 'flat.png'), 96);
    assert.equal(result.id, undefined);
    assert.equal(result.documentId, undefined);
  });

  const raw = path.join(samples, 'nikon.nef');
  if (!existsSync(raw)) {
    await suite.check('raw thumbnails (skipped: no camera files in .tooling)', async () => {});
  } else {
    await suite.check("a raw file is read through the camera's own preview", async () => {
      const { result } = await thumbnail(raw, 256);
      assert.equal(result.format, 'raw');
      assert.equal(result.embedded, true, 'the embedded preview was not used');
    });

    await suite.check('a raw file reports the size of the photograph, not the preview', async () => {
      // The preview inside a raw file is a couple of megapixels; the frame is
      // twenty-four. Reporting the preview's size would make every raw file in
      // a folder claim to be small.
      const { result } = await thumbnail(raw, 256);
      assert.ok(
        result.sourceWidth > 4000,
        `the frame came back as ${result.sourceWidth}x${result.sourceHeight}`,
      );
    });

    const portrait = path.join(samples, 'iphone.dng');
    if (existsSync(portrait)) {
      await suite.check('a portrait frame comes back portrait', async () => {
        // The preview inside this file carries its own EXIF orientation and the
        // camera also records a flip; applying both leaves it on its side.
        const { result } = await thumbnail(portrait, 256);
        assert.ok(result.height > result.width, `${result.width}x${result.height}`);
        assert.ok(
          result.sourceHeight > result.sourceWidth,
          `the frame is reported as ${result.sourceWidth}x${result.sourceHeight}`,
        );
      });
    }
  }

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
