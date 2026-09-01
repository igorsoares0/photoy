import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/electron/ipc/paths.ts');

/**
 * The gate every path from the renderer goes through.
 *
 * Worth its own suite because it is the piece that decides which door a file
 * goes in by, and getting that wrong turns "open my project" into a refusal
 * with nothing in it to explain the refusal - which is exactly what shipped.
 */
export async function run() {
  const suite = createSuite('path validation');
  const {
    resolveReadablePath,
    resolveProjectPath,
    resolveWritablePath,
    hasReadableExtension,
    OPEN_FILTERS,
    EXPORT_FILTERS,
  } = await import(`file://${source}`);

  const directory = mkdtempSync(path.join(tmpdir(), 'photoy-paths-'));
  const photo = path.join(directory, 'foto.jpg');
  const project = path.join(directory, 'foto.myphoto');
  const folder = path.join(directory, 'uma-pasta');
  const negative = path.join(directory, 'DSC00042.ARW');
  writeFileSync(photo, 'not really a jpeg');
  writeFileSync(project, 'not really a zip');
  writeFileSync(negative, 'not really a raw file');
  mkdirSync(folder, { recursive: true });

  await suite.check('a photograph passes the readable gate', async () => {
    assert.equal(resolveReadablePath(photo), photo);
  });

  await suite.check('a project does not pass the readable gate', async () => {
    // It is not something the decoder can read, and letting it through would
    // turn opening a project into a decode failure.
    assert.throws(() => resolveReadablePath(project), /Unsupported file type/);
  });

  await suite.check('a project passes the project gate', async () => {
    assert.equal(resolveProjectPath(project), project);
  });

  await suite.check('a photograph does not pass the project gate', async () => {
    assert.throws(() => resolveProjectPath(photo), /Not a project/);
  });

  await suite.check('a raw file passes the readable gate, whatever its case', async () => {
    // The extension only decides which files the guard lets through; the engine
    // still sniffs the bytes. Rejecting here would mean the sniffer never runs.
    assert.equal(resolveReadablePath(negative), negative);
  });

  await suite.check('a HEIC passes the readable gate', async () => {
    // It opens only where the platform has the codec, but the guard is not the
    // place to decide that: refusing here would replace an error that says what
    // to install with a dialog that does not show the file at all.
    const phone = path.join(directory, 'IMG_0042.HEIC');
    writeFileSync(phone, 'not really a heic');
    assert.equal(resolveReadablePath(phone), phone);
    assert.equal(hasReadableExtension('foto.heif'), true);
  });

  await suite.check('HEIC is offered for opening but never for export', async () => {
    // Reading it borrows the platform's decoder; writing it would mean shipping
    // an HEVC encoder, which is the thing this whole approach exists to avoid.
    assert.ok(OPEN_FILTERS.some((filter) => filter.name === 'HEIC'));
    assert.ok(EXPORT_FILTERS.every((filter) => filter.name !== 'HEIC'));
    assert.ok(EXPORT_FILTERS.every((filter) => !filter.extensions.includes('heic')));
  });

  await suite.check('raw is offered for opening but never for export', async () => {
    // A raw file cannot be written: there is no way back from edited pixels to
    // a sensor mosaic. The two filter lists exist so the save dialog cannot
    // drift into offering one.
    const openNames = OPEN_FILTERS.map((filter) => filter.name);
    assert.ok(openNames.includes('RAW'));
    assert.ok(EXPORT_FILTERS.every((filter) => filter.name !== 'RAW'));
    assert.ok(EXPORT_FILTERS.every((filter) => !filter.extensions.includes('arw')));
  });

  await suite.check('the extension check and the path guard agree', async () => {
    // Two lists that answer "can this be opened" would drift; the command line
    // path has to accept exactly what the dialog offers.
    assert.equal(hasReadableExtension('DSC00042.ARW'), true);
    assert.equal(hasReadableExtension('foto.jpg'), true);
    assert.equal(hasReadableExtension('projeto.myphoto'), false);
    for (const extension of OPEN_FILTERS[0].extensions) {
      assert.equal(hasReadableExtension(`x.${extension}`), true, extension);
    }
  });

  await suite.check('a file that is not there is refused, not opened', async () => {
    assert.throws(() => resolveProjectPath(path.join(directory, 'ausente.myphoto')), /File not found/);
    assert.throws(() => resolveReadablePath(path.join(directory, 'ausente.jpg')), /File not found/);
  });

  await suite.check('a directory is not a file', async () => {
    const named = path.join(folder, 'x.myphoto');
    mkdirSync(named, { recursive: true });
    assert.throws(() => resolveProjectPath(named), /Not a file/);
  });

  await suite.check('anything that is not a string is refused', async () => {
    for (const rubbish of [null, undefined, 42, {}, '']) {
      assert.throws(() => resolveProjectPath(rubbish), /Invalid file path/);
      assert.throws(() => resolveReadablePath(rubbish), /Invalid file path/);
    }
  });

  await suite.check('a project is not an export destination', async () => {
    assert.throws(() => resolveWritablePath(project), /Unsupported export format/);
  });

  await suite.check('the extension is matched whatever its case', async () => {
    const shouting = path.join(directory, 'GRITANDO.MYPHOTO');
    writeFileSync(shouting, 'not really a zip');
    assert.equal(resolveProjectPath(shouting), shouting);
  });

  rmSync(directory, { recursive: true, force: true });
  return suite.report();
}
