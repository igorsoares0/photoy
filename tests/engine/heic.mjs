import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { spawnSync } from 'node:child_process';

import { EngineClient } from './client.mjs';
import { createSuite, pixelAt } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

/**
 * HEIC, which the engine reads through the platform rather than through a
 * decoder of its own.
 *
 * The fixture only exists on a machine that has the codec, and so does the
 * feature, so the suite reports itself skipped rather than failing somewhere it
 * could never have worked.
 */
export async function run() {
  const suite = createSuite('heic');
  const sample = path.join(fixtures, 'subject.heic');
  if (!existsSync(sample)) {
    console.log('\nheic\n  SKIP  no HEIF codec on this machine, so there is no fixture');
    return 0;
  }

  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-heic-'));

  /** Converts through the platform's codec, or reports that there is none. */
  const makeHeic = (source, target) => {
    const tool = ['Release', 'Debug']
      .map((config) => path.join(root, 'build', config, 'bin', 'heic-fixture.exe'))
      .find((candidate) => existsSync(candidate));
    if (tool === undefined) return false;
    return spawnSync(tool, [source, target], { encoding: 'utf8' }).status === 0;
  };
  const open = async (file) => {
    const { result } = await engine.call('image.open', {
      path: path.isAbsolute(file) ? file : path.join(fixtures, file),
    });
    return result;
  };

  await suite.check('a HEIC is recognised by its brand, not its extension', async () => {
    const opened = await open('subject.heic');
    assert.equal(opened.image.format, 'heif');
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a Canon CR3 is not mistaken for one', async () => {
    // Both are ISO base media files whose first bytes are identical; only the
    // brand four bytes later tells them apart. This is the regression the
    // shared container invites.
    const cr3 = path.join(root, '.tooling', 'raw-samples', 'canon.cr3');
    if (!existsSync(cr3)) return;  // the sample is not part of the repository
    const opened = await open(cr3);
    assert.equal(opened.image.format, 'raw');
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('the pixels come back matching the source', async () => {
    // The fixture is subject.png put through the platform's HEIC encoder, so
    // the PNG is the answer key and the only difference should be what a lossy
    // codec costs.
    const png = await open('subject.png');
    const a = await engine.call('image.renderPreview', { documentId: png.id });
    const heic = await open('subject.heic');
    const b = await engine.call('image.renderPreview', { documentId: heic.id });

    assert.equal(b.result.width, a.result.width);
    assert.equal(b.result.height, a.result.height);
    let total = 0;
    let count = 0;
    for (let y = 0; y < a.result.height; y += 3) {
      for (let x = 0; x < a.result.width; x += 3) {
        const one = pixelAt(a.payload, a.result.stride, x, y);
        const two = pixelAt(b.payload, b.result.stride, x, y);
        for (let c = 0; c < 3; c += 1) total += Math.abs(one[c] - two[c]);
        count += 3;
      }
    }
    const mean = total / count;
    assert.ok(mean < 4, `mean difference ${mean.toFixed(2)} is more than compression explains`);
    await engine.call('image.close', { documentId: png.id });
    await engine.call('image.close', { documentId: heic.id });
  });

  await suite.check('a HEIC takes edits and exports like any other photograph', async () => {
    const opened = await open('subject.heic');
    await engine.call('edit.apply', {
      documentId: opened.id,
      operation: { kind: 'adjust', adjustments: { exposure: 1 } },
    });
    const target = path.join(workDir, 'from-heic.jpg');
    const { result } = await engine.call('image.export', {
      documentId: opened.id, path: target, format: 'jpeg', quality: 90,
    });
    assert.equal(result.width, opened.image.width);
    assert.ok(existsSync(target));
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('an embedded colour profile survives the conversion', async () => {
    // The path that decides whether a phone photograph opens in its own colours
    // or desaturated. Built from our own exporter rather than somebody's file:
    // the engine writes a Display P3 PNG, the platform's codec carries the
    // profile into a HEIC, and the engine has to find it again on the way back.
    const source = await open('subject.png');
    const tagged = path.join(workDir, 'p3.png');
    await engine.call('image.export', {
      documentId: source.id, path: tagged, format: 'png', colorSpace: 'display-p3',
    });
    await engine.call('image.close', { documentId: source.id });

    const converted = path.join(workDir, 'p3.heic');
    if (!makeHeic(tagged, converted)) return;  // no codec here

    const opened = await open(converted);
    assert.equal(opened.image.tagged, true, 'the profile did not survive');
    assert.match(opened.image.sourceProfile, /P3/i);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a photograph from a phone opens upright and in its own colours', async () => {
    // The one thing a built fixture cannot prove. Skipped unless somebody has
    // put a real HEIC at .tooling/phone.heic, because a photograph from a phone
    // is not something to commit: it belongs to whoever took it.
    const real = path.join(root, '.tooling', 'phone.heic');
    if (!existsSync(real)) return;

    const opened = await open(real);
    assert.equal(opened.image.format, 'heif');
    // The container declares a rotation and the codec applies it, so the frame
    // arrives taller than it is wide and nothing further is owed. A decoder
    // that rotated again would swap these back.
    assert.ok(opened.image.height > opened.image.width, 'a portrait photograph came back landscape');
    assert.equal(opened.image.orientation, 1);
    // Ten bits from a phone's HDR capture, widened rather than flattened.
    assert.equal(opened.image.bitDepth, 16);
    assert.equal(opened.image.tagged, true);
    assert.match(opened.image.sourceProfile, /P3/i);
    await engine.call('image.close', { documentId: opened.id });
  });

  await suite.check('a broken HEIC is refused with something to act on', async () => {
    // The brand says HEIF and the rest is nonsense, so the codec is reached and
    // refuses. The message has to name the file rather than the machine: a user
    // told to install an extension they already have would go round in circles.
    const broken = path.join(workDir, 'broken.heic');
    const header = Buffer.alloc(64);
    header.write('ftyp', 4, 'ascii');
    header.write('heic', 8, 'ascii');
    writeFileSync(broken, header);
    await assert.rejects(
      () => open(broken),
      (error) => {
        assert.match(error.message, /decode_failed|unsupported_format/);
        return true;
      },
    );
  });

  await suite.check('describe lists heif among the formats it decodes', async () => {
    const { result } = await engine.call('engine.describe');
    assert.ok(result.decodeFormats.includes('heif'));
    // And never among what it writes: there is no encoder here, on purpose.
    assert.ok(!result.encodeFormats.includes('heif'));
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
