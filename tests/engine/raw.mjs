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

/**
 * The value a half-scale linear scene lands on once it has been through the
 * sRGB transfer curve for the screen: 0.5 linear encodes to 0.7354, which is
 * 187.5 of 255. It is the number that says the decode kept the light linear
 * and did not brighten anything on its own.
 */
const HALF_SCALE_SRGB = 188;

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('raw');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-raw-'));

  const open = async (file) => {
    const { result } = await engine.call('image.open', {
      path: path.isAbsolute(file) ? file : path.join(fixtures, file),
    });
    return result;
  };
  const preview = async (documentId) => {
    const { result, payload } = await engine.call('image.renderPreview', { documentId });
    return { info: result, payload };
  };

  await suite.check('a DNG is recognised as raw, not as the TIFF it is built on', async () => {
    const opened = await open('neutral.dng');
    assert.equal(opened.image.format, 'raw');
    assert.equal(opened.image.sourceWidth, 64);
    assert.equal(opened.image.sourceHeight, 64);
    assert.equal(opened.image.bitDepth, 16);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a raw decode arrives already in the working space', async () => {
    const opened = await open('neutral.dng');
    // Not merely tagged: raw has no embedded profile to inherit, so the decoder
    // converts on the way out and says so. Anything else would be read as sRGB
    // and lose the camera gamut the working space exists to hold.
    assert.equal(opened.image.tagged, true);
    assert.match(opened.image.sourceProfile, /working space/i);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a neutral scene decodes neutral, at the level linear light predicts', async () => {
    const opened = await open('neutral.dng');
    const { info, payload } = await preview(opened.id);
    const [r, g, b] = pixelAt(payload, info.stride, 32, 32);
    assert.equal(r, g, 'red and green disagree, so the white point moved');
    assert.equal(g, b, 'green and blue disagree, so the white point moved');
    assert.equal(r, HALF_SCALE_SRGB);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('the camera white balance in the file is applied', async () => {
    // warm.dng records twice as much red for the same neutral scene. It can
    // only land on the same grey as neutral.dng if AsShotNeutral was honoured.
    const opened = await open('warm.dng');
    const { info, payload } = await preview(opened.id);
    const [r, g, b] = pixelAt(payload, info.stride, 32, 32);
    assert.deepEqual([r, g, b], [HALF_SCALE_SRGB, HALF_SCALE_SRGB, HALF_SCALE_SRGB]);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a raw document takes edits like any other', async () => {
    const opened = await open('neutral.dng');
    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: { kind: 'adjust', adjustments: { exposure: 1 } },
    });
    const { info, payload } = await preview(opened.id);
    const [r] = pixelAt(payload, info.stride, 32, 32);
    // A stop of exposure doubles the light, and 188 is not near the ceiling.
    assert.ok(r > HALF_SCALE_SRGB + 30, `expected a brighter pixel, got ${r}`);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a raw document exports like any other', async () => {
    const opened = await open('neutral.dng');
    const target = path.join(workDir, 'from-raw.jpg');
    const { result } = await engine.call('image.export', {
      documentId: opened.id,
      path: target,
      format: 'jpeg',
      quality: 95,
    });
    assert.equal(result.width, 64);
    assert.ok(existsSync(target));
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a raw file reports the white balance the camera used', async () => {
    const opened = await open('neutral.dng');
    // The fixture declares an equal-energy neutral, so the temperature read
    // back has to be a real number in a plausible range rather than a default.
    assert.equal(opened.image.raw.adjustable, true);
    assert.ok(opened.image.raw.asShotTemperature > 2000);
    assert.ok(opened.image.raw.asShotTemperature < 25000);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('feeding the reported balance back reproduces the file', async () => {
    // The strongest thing that can be said about the white-balance maths: the
    // temperature read out of the camera's own multipliers, put back in as a
    // temperature, has to decode to the same photograph. It goes through the
    // locus, the tint normal and the camera matrix in both directions, so
    // anything wrong in any of them shows up here as a colour shift.
    const opened = await open('warm.dng');
    const before = await preview(opened.id);
    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: {
        kind: 'developRaw',
        custom: true,
        temperature: opened.image.raw.asShotTemperature,
        tint: opened.image.raw.asShotTint,
      },
    });
    const after = await preview(opened.id);
    assert.deepEqual(
      pixelAt(after.payload, after.info.stride, 32, 32),
      pixelAt(before.payload, before.info.stride, 32, 32),
    );
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a warmer temperature makes a warmer photograph', async () => {
    // The direction the slider moves the picture, which is the one thing about
    // this control a person notices immediately if it is backwards.
    const opened = await open('neutral.dng');
    const shot = opened.image.raw.asShotTemperature;
    const warmth = async (kelvin) => {
      await engine.call('edit.apply', {
        documentId: opened.id,
        operation: { kind: 'developRaw', custom: true, temperature: kelvin, tint: 0 },
      });
      const { info, payload } = await preview(opened.id);
      const [r, , b] = pixelAt(payload, info.stride, 32, 32);
      return r - b;
    };
    assert.ok((await warmth(shot * 1.5)) > (await warmth(shot * 0.7)));
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('positive tint goes magenta and negative goes green', async () => {
    const opened = await open('neutral.dng');
    const shot = opened.image.raw.asShotTemperature;
    const magenta = async (value) => {
      await engine.call('edit.apply', {
        documentId: opened.id,
        operation: { kind: 'developRaw', custom: true, temperature: shot, tint: value },
      });
      const { info, payload } = await preview(opened.id);
      const [r, g, b] = pixelAt(payload, info.stride, 32, 32);
      return (r + b) / 2 - g;
    };
    assert.ok((await magenta(100)) > (await magenta(-100)));
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('the camera balance can be returned to', async () => {
    const opened = await open('warm.dng');
    const before = await preview(opened.id);
    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: { kind: 'developRaw', custom: true, temperature: 9000, tint: 60 },
    });
    const moved = await preview(opened.id);
    assert.notDeepEqual(
      pixelAt(moved.payload, moved.info.stride, 32, 32),
      pixelAt(before.payload, before.info.stride, 32, 32),
    );

    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: { kind: 'developRaw', custom: false },
    });
    const back = await preview(opened.id);
    assert.deepEqual(
      pixelAt(back.payload, back.info.stride, 32, 32),
      pixelAt(before.payload, before.info.stride, 32, 32),
    );
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('undo takes the white balance back with everything else', async () => {
    const opened = await open('warm.dng');
    const before = await preview(opened.id);
    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: { kind: 'developRaw', custom: true, temperature: 9000, tint: 0 },
    });
    await engine.call('edit.undo', { documentId: opened.id });
    const back = await preview(opened.id);
    assert.deepEqual(
      pixelAt(back.payload, back.info.stride, 32, 32),
      pixelAt(before.payload, before.info.stride, 32, 32),
    );
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a white balance survives a project round trip', async () => {
    // Raw development is the one operation that changes what the decoder
    // produces, so a project that forgot it would reopen looking different
    // from the one that was saved - the failure the user already hit once.
    const opened = await open('warm.dng');
    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: { kind: 'developRaw', custom: true, temperature: 8200, tint: -45 },
    });
    const saved = await preview(opened.id);
    const target = path.join(workDir, 'balanced.myphoto');
    await engine.call('project.save', { documentId: opened.id, path: target });
    await engine.call('image.close', { documentId: opened.id });

    const reopened = await engine.call('project.open', { path: target });
    const documentId = reopened.result.id;
    const { result: history } = await engine.call('edit.history', { documentId });
    assert.equal(history.raw.custom, true);
    assert.equal(Math.round(history.raw.temperature), 8200);
    assert.equal(Math.round(history.raw.tint), -45);

    const restored = await preview(documentId);
    assert.deepEqual(
      pixelAt(restored.payload, restored.info.stride, 32, 32),
      pixelAt(saved.payload, saved.info.stride, 32, 32),
    );
    await engine.call('image.close', { documentId });
  });

  await suite.check('a file with no camera matrix is not offered the controls', async () => {
    // An ordinary photograph is not raw and has no white balance to reach.
    // Saying so explicitly is what the panel keys off.
    const opened = await open('gradient.png');
    assert.equal(opened.image.raw.adjustable, false);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a raw file can serve as a backdrop', async () => {
    // The backdrop path decodes a second file and, for raw, moves its pixels
    // straight through instead of converting them. Untested, that move is the
    // kind of thing that reads fine and hands back an empty image.
    const documentId = (await open('gradient.png')).id;
    const { result } = await engine.call('background.load', {
      documentId,
      path: path.join(fixtures, 'neutral.dng'),
    });
    assert.ok(result.patch > 0, 'the backdrop came back empty');
    await engine.call('image.close', { documentId });
  });

  await suite.check('an ordinary TIFF is not mistaken for raw', async () => {
    // The probe that finds raw inside a TIFF container runs on every TIFF, so
    // this is the regression it could cause: a plain TIFF taken for a raw file
    // and handed to a decoder that cannot read it.
    const source = await open('gradient.png');
    const target = path.join(workDir, 'plain.tif');
    await engine.call('image.export', { documentId: source.id, path: target, format: 'tiff' });
    await engine.call('image.close', { documentId: source.id });

    const reopened = await open(target);
    assert.equal(reopened.image.format, 'tiff');
    await engine.call('image.close', { documentId: reopened.id });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
