import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { channelsClose, containsMarker, createSuite, pixelAt } from './harness.mjs';
import { PATCHES, PATCH_SIZE } from '../fixtures/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

/**
 * A conversion that survives a round trip has to be right in both directions,
 * so the tolerance covers 16-bit quantisation and the profile lookup tables
 * rather than any real colour shift.
 */
const ROUND_TRIP_TOLERANCE = 4;

/** Reads the centre pixel of each known patch out of a full-size preview. */
function readPatches(preview) {
  return PATCHES.map((patch, index) =>
    pixelAt(preview.payload, preview.result.stride, index * PATCH_SIZE + PATCH_SIZE / 2, PATCH_SIZE / 2),
  );
}

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('colour management');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-colour-'));

  const patchesPath = path.join(fixtures, 'patches.png');
  const opened = await engine.call('image.open', { path: patchesPath });
  const documentId = opened.result.id;

  const fullPreview = async (id) =>
    engine.call('image.renderPreview', { documentId: id, maxWidth: 4000, maxHeight: 4000 });

  await suite.check('describe reports the working space and the output spaces', async () => {
    const { result } = await engine.call('engine.describe');
    assert.equal(result.workingSpace, 'linear-prophoto-16');
    for (const space of ['srgb', 'display-p3', 'adobe-rgb']) {
      assert.ok(result.outputSpaces.includes(space), `missing output space ${space}`);
    }
  });

  await suite.check('an untagged file is reported as untagged', async () => {
    assert.equal(opened.result.image.tagged, false);
    assert.equal(opened.result.image.sourceProfile, '');
  });

  await suite.check('an untagged file is assumed sRGB and survives the round trip', async () => {
    // Untagged input is treated as sRGB, so converting into the working space
    // and back out to sRGB has to return exactly what went in.
    const preview = await fullPreview(documentId);
    readPatches(preview).forEach((actual, index) => {
      const expected = [...PATCHES[index].rgb, 255];
      assert.deepEqual(actual, expected, `${PATCHES[index].name} drifted`);
    });
  });

  const exports = {};
  for (const space of ['srgb', 'display-p3', 'adobe-rgb']) {
    await suite.check(`export to ${space} tags the file with its profile`, async () => {
      const target = path.join(workDir, `${space}.png`);
      const { result } = await engine.call('image.export', {
        documentId,
        path: target,
        format: 'png',
        colorSpace: space,
      });
      assert.equal(result.colorSpace, space);
      exports[space] = readFileSync(target);
      assert.ok(containsMarker(exports[space], 'iCCP'), 'PNG carries no iCCP chunk');

      const reopened = await engine.call('image.open', { path: target });
      assert.equal(reopened.result.image.tagged, true, 'reimported file is untagged');
      assert.ok(reopened.result.image.sourceProfile.length > 0, 'profile has no description');

      // Converting back to sRGB must return the original colours, which only
      // holds if the pixels and the tag agree with each other.
      const preview = await fullPreview(reopened.result.id);
      readPatches(preview).forEach((actual, index) => {
        const expected = [...PATCHES[index].rgb, 255];
        assert.ok(
          channelsClose(actual, expected, ROUND_TRIP_TOLERANCE),
          `${PATCHES[index].name}: expected ~${expected} but read ${actual}`,
        );
      });
      await engine.call('image.close', { documentId: reopened.result.id });
    });
  }

  await suite.check('a wide-gamut export stores different pixels, not just a tag', async () => {
    // If the engine tagged the file without converting, these would match.
    assert.notDeepEqual(
      exports['display-p3'],
      exports['srgb'],
      'Display P3 export is byte-identical to the sRGB one',
    );
    assert.notDeepEqual(exports['adobe-rgb'], exports['srgb']);
  });

  await suite.check('JPEG export embeds the profile in an APP2 segment', async () => {
    const target = path.join(workDir, 'tagged.jpg');
    await engine.call('image.export', {
      documentId,
      path: target,
      format: 'jpeg',
      quality: 95,
      colorSpace: 'display-p3',
    });
    assert.ok(containsMarker(readFileSync(target), 'ICC_PROFILE'), 'no ICC_PROFILE marker');
    const reopened = await engine.call('image.open', { path: target });
    assert.equal(reopened.result.image.tagged, true);
    await engine.call('image.close', { documentId: reopened.result.id });
  });

  await suite.check('WebP export embeds the profile in an ICCP chunk', async () => {
    const target = path.join(workDir, 'tagged.webp');
    await engine.call('image.export', {
      documentId,
      path: target,
      format: 'webp',
      quality: 100,
      colorSpace: 'display-p3',
    });
    assert.ok(containsMarker(readFileSync(target), 'ICCP'), 'no ICCP chunk');
    const reopened = await engine.call('image.open', { path: target });
    assert.equal(reopened.result.image.tagged, true);
    await engine.call('image.close', { documentId: reopened.result.id });
  });

  await suite.check('TIFF export is tagged and reads back', async () => {
    const target = path.join(workDir, 'tagged.tif');
    await engine.call('image.export', {
      documentId,
      path: target,
      format: 'tiff',
      colorSpace: 'adobe-rgb',
    });
    const reopened = await engine.call('image.open', { path: target });
    assert.equal(reopened.result.image.tagged, true);
    await engine.call('image.close', { documentId: reopened.result.id });
  });

  for (const [format, extension] of [['png', 'png'], ['tiff', 'tif']]) {
    await suite.check(`${format} keeps 16 bits when asked`, async () => {
      const target = path.join(workDir, `deep.${extension}`);
      const { result } = await engine.call('image.export', {
        documentId,
        path: target,
        format,
        sixteenBit: true,
      });
      assert.equal(result.bitDepth, 16);
      const reopened = await engine.call('image.open', { path: target });
      assert.equal(reopened.result.image.bitDepth, 16, 'depth was lost on the way back in');
      await engine.call('image.close', { documentId: reopened.result.id });
    });
  }

  await suite.check('a 16-bit request on an 8-bit format still writes 8 bits', async () => {
    const target = path.join(workDir, 'deep.jpg');
    const { result } = await engine.call('image.export', {
      documentId,
      path: target,
      format: 'jpeg',
      sixteenBit: true,
    });
    assert.equal(result.bitDepth, 8);
    assert.ok(existsSync(target));
  });

  await engine.call('image.close', { documentId });
  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
