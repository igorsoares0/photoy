import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, copyFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite } from './harness.mjs';
import { NEUTRAL_ADJUSTMENTS } from '../../packages/types/src/edit.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');
const batchSource = path.resolve(root, 'apps/desktop/electron/ipc/batch.ts');

/**
 * The batch loop, driven against the real engine.
 *
 * The loop is the part that decides what happens to two hundred of somebody's
 * photographs, so it is exercised the way it runs: real files opened, adjusted,
 * exported and closed, one at a time. Only the two hooks that belong to Electron
 * - the progress report and the path guard - are stood in for here.
 */
export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('batch export');
  const engine = new EngineClient(enginePath);
  const { runBatch } = await import(`file://${batchSource}`);

  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-batch-'));
  const sources = path.join(workDir, 'entrada');
  const targets = path.join(workDir, 'saida');
  for (const directory of [sources, targets]) rmSync(directory, { recursive: true, force: true });
  const { mkdirSync } = await import('node:fs');
  mkdirSync(sources, { recursive: true });
  mkdirSync(targets, { recursive: true });

  // Three real photographs, copied so the run has its own to work on.
  const named = ['uma.png', 'duas.png', 'tres.png'];
  for (const name of named) copyFileSync(path.join(fixtures, 'gradient.png'), path.join(sources, name));
  const paths = named.map((name) => path.join(sources, name));

  const request = (overrides = {}) => ({
    paths,
    adjustments: null,
    name: 'Lote',
    targetDirectory: targets,
    format: 'jpeg',
    quality: 90,
    colorSpace: 'srgb',
    maxSide: null,
    preserveMetadata: true,
    ...overrides,
  });

  const hooks = (overrides = {}) => ({
    reports: [],
    ...overrides,
  });

  /** Runs the loop, collecting what the progress hook was told. */
  const execute = async (overrides = {}, { cancelAfter = null } = {}) => {
    const reports = [];
    let seen = 0;
    const result = await runBatch(engine, request(overrides), {
      report: (done, total, current) => reports.push({ done, total, current }),
      cancelled: () => {
        const stop = cancelAfter !== null && seen >= cancelAfter;
        seen += 1;
        return stop;
      },
      resolve: (candidate) => candidate,
    });
    return { result, reports };
  };

  await suite.check('every photograph comes out the other side', async () => {
    const { result } = await execute();
    assert.equal(result.exported, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.cancelled, false);
    for (const name of ['uma.jpg', 'duas.jpg', 'tres.jpg']) {
      const written = path.join(targets, name);
      assert.ok(existsSync(written), `${name} was not written`);
      assert.ok(statSync(written).size > 0, `${name} is empty`);
    }
  });

  await suite.check('the exported files are the photographs, not copies of the source', async () => {
    // A batch that copied the bytes across would pass every check above.
    const opened = await engine.call('image.open', { path: path.join(targets, 'uma.jpg') });
    assert.equal(opened.result.image.format, 'jpeg');
    assert.equal(opened.result.image.width, 200);
    assert.equal(opened.result.image.height, 120);
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('a look reaches every file in the batch', async () => {
    rmSync(targets, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(targets, { recursive: true });

    const dark = { ...NEUTRAL_ADJUSTMENTS, exposure: -2 };
    const { result } = await execute({ adjustments: dark });
    assert.equal(result.exported, 3);

    // Measured rather than assumed: two stops down has to show up in the
    // pixels of every file, or the adjustments never left the request object.
    for (const name of ['uma.jpg', 'duas.jpg', 'tres.jpg']) {
      const opened = await engine.call('image.open', { path: path.join(targets, name) });
      const preview = await engine.call('image.renderPreview', {
        documentId: opened.result.id,
        maxWidth: 400,
        maxHeight: 400,
      });
      const { stride } = preview.result;
      // A pixel from the ramp, well clear of the magenta block.
      const value = preview.payload[5 * stride + 150 * 4];
      assert.ok(value < 120, `${name} came out at ${value}, which is not two stops down`);
      await engine.call('image.close', { documentId: opened.result.id });
    }
  });

  await suite.check('a size limit reduces and never enlarges', async () => {
    rmSync(targets, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(targets, { recursive: true });

    await execute({ maxSide: 100 });
    const opened = await engine.call('image.open', { path: path.join(targets, 'uma.jpg') });
    assert.equal(opened.result.image.width, 100);
    assert.equal(opened.result.image.height, 60);
    await engine.call('image.close', { documentId: opened.result.id });

    // The same batch asked for a limit larger than the photograph leaves it
    // alone: a batch that enlarged to reach a number would be inventing detail.
    rmSync(targets, { recursive: true, force: true });
    mkdirSync(targets, { recursive: true });
    await execute({ maxSide: 4000 });
    const untouched = await engine.call('image.open', { path: path.join(targets, 'uma.jpg') });
    assert.equal(untouched.result.image.width, 200);
    await engine.call('image.close', { documentId: untouched.result.id });
  });

  await suite.check('one bad file does not stop the rest', async () => {
    rmSync(targets, { recursive: true, force: true });
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(targets, { recursive: true });

    const broken = path.join(sources, 'quebrada.png');
    writeFileSync(broken, Buffer.from('this is not a photograph'));
    const result = await runBatch(
      engine,
      { ...request(), paths: [paths[0], broken, paths[1]] },
      { report: () => {}, cancelled: () => false, resolve: (candidate) => candidate },
    );
    assert.equal(result.exported, 2);
    assert.equal(result.failed, 1);
    const failure = result.items.find((item) => item.outcome === 'failed');
    assert.equal(failure.path, broken);
    assert.ok((failure.error ?? '').length > 0, 'a failure with nothing to read');
    rmSync(broken, { force: true });
  });

  await suite.check('a batch never writes over its own source', async () => {
    // The same folder, the same format: without the guard this would encode a
    // JPEG over the JPEG it was made from, once per file.
    const jpegSource = path.join(workDir, 'mesma');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(jpegSource, { recursive: true });
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'gradient.png') });
    await engine.call('image.export', {
      documentId: opened.result.id,
      path: path.join(jpegSource, 'foto.jpg'),
      format: 'jpeg',
    });
    await engine.call('image.close', { documentId: opened.result.id });

    const before = statSync(path.join(jpegSource, 'foto.jpg'));
    const result = await runBatch(
      engine,
      { ...request(), paths: [path.join(jpegSource, 'foto.jpg')], targetDirectory: jpegSource },
      { report: () => {}, cancelled: () => false, resolve: (candidate) => candidate },
    );
    assert.equal(result.exported, 0);
    assert.equal(result.failed, 1);
    assert.equal(statSync(path.join(jpegSource, 'foto.jpg')).size, before.size, 'the source was rewritten');
  });

  await suite.check('cancelling leaves what was already written', async () => {
    rmSync(targets, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(targets, { recursive: true });

    const { result } = await execute({}, { cancelAfter: 1 });
    assert.equal(result.cancelled, true);
    assert.equal(result.exported, 1, 'the file already being written should survive');
    assert.equal(readdirSync(targets).length, 1);
    assert.equal(result.items.filter((item) => item.outcome === 'cancelled').length, 2);
  });

  await suite.check('progress is reported as a real fraction', async () => {
    rmSync(targets, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(targets, { recursive: true });

    const { reports } = await execute();
    assert.deepEqual(
      reports.map((entry) => entry.done),
      [0, 1, 2, 3],
      'the count should climb once per file and finish at the total',
    );
    assert.ok(reports.every((entry) => entry.total === 3));
    assert.equal(reports.at(-1).current, null, 'the last report should name no file');
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
