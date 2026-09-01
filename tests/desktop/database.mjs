import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/electron/store/database.ts');

/**
 * The application's structured data.
 *
 * Tested from plain Node rather than through Electron: `node:sqlite` is the
 * same module in both, so the only thing a window would add here is minutes.
 */
export async function run() {
  const suite = createSuite('application database');
  const { Database } = await import(`file://${source}`);
  const directory = mkdtempSync(path.join(tmpdir(), 'photoy-db-'));

  const fresh = () => new Database(mkdtempSync(path.join(tmpdir(), 'photoy-db-')));
  const preset = (id, name, category = 'colour', adjustments = { contrast: 20 }) => ({
    id, name, category, adjustments,
  });

  await suite.check('a preset survives being written and read', async () => {
    const db = fresh();
    db.savePreset(preset('user.1', 'Meu look', 'landscape', { contrast: 20, vibrance: 15 }));
    const [stored] = db.listPresets();
    assert.equal(stored.id, 'user.1');
    assert.equal(stored.name, 'Meu look');
    assert.equal(stored.category, 'landscape');
    assert.equal(stored.adjustments.contrast, 20);
    assert.equal(stored.adjustments.vibrance, 15);
    // Anything the preset did not set comes back neutral rather than missing.
    assert.equal(stored.adjustments.exposure, 0);
    assert.equal(stored.builtIn, false, 'a stored preset must never claim to be built in');
    db.close();
  });

  await suite.check('saving over an identifier updates rather than duplicates', async () => {
    const db = fresh();
    db.savePreset(preset('user.1', 'Antes'));
    db.savePreset(preset('user.1', 'Depois'));
    const all = db.listPresets();
    assert.equal(all.length, 1);
    assert.equal(all[0].name, 'Depois');
    db.close();
  });

  await suite.check('a preset can be deleted', async () => {
    const db = fresh();
    db.savePreset(preset('user.1', 'Um'));
    db.savePreset(preset('user.2', 'Dois'));
    db.deletePreset('user.1');
    assert.deepEqual(db.listPresets().map((entry) => entry.id), ['user.2']);
    db.close();
  });

  await suite.check('a category that is not one is read as colour', async () => {
    // The column is text, and a file on disk is not a promise about its content.
    const db = fresh();
    db.savePreset(preset('user.1', 'Estranho', 'nonsense'));
    assert.equal(db.listPresets()[0].category, 'colour');
    db.close();
  });

  await suite.check('an unreadable preset comes back neutral, not thrown', async () => {
    // A preset that does nothing is better than a panel that cannot draw.
    const db = fresh();
    db.savePreset({ id: 'user.1', name: 'Quebrado', category: 'colour', adjustments: 'not json' });
    const [stored] = db.listPresets();
    assert.equal(stored.adjustments.contrast, 0);
    db.close();
  });

  await suite.check('a value that is not a number is ignored', async () => {
    const db = fresh();
    db.savePreset(preset('user.1', 'Torto', 'colour', { contrast: 'muito', vibrance: 10 }));
    const [stored] = db.listPresets();
    assert.equal(stored.adjustments.contrast, 0);
    assert.equal(stored.adjustments.vibrance, 10);
    db.close();
  });

  await suite.check('recent files come back newest first', async () => {
    const db = fresh();
    db.rememberFile('/a.jpg');
    db.rememberFile('/b.jpg');
    db.rememberFile('/a.jpg');
    assert.deepEqual(db.recentFiles().slice(0, 2), ['/a.jpg', '/b.jpg']);
    db.close();
  });

  await suite.check('the recent list is bounded', async () => {
    // Otherwise it grows for the life of the installation to no purpose.
    const db = fresh();
    for (let i = 0; i < 40; i += 1) db.rememberFile(`/photo-${i}.jpg`);
    const recent = db.recentFiles();
    assert.ok(recent.length <= 20, `${recent.length} entries`);
    assert.equal(recent[0], '/photo-39.jpg');
    db.close();
  });

  await suite.check('a file can be forgotten', async () => {
    const db = fresh();
    db.rememberFile('/gone.jpg');
    db.forgetFile('/gone.jpg');
    assert.deepEqual(db.recentFiles(), []);
    db.close();
  });

  await suite.check('the database is there again after being reopened', async () => {
    // The point of it: presets outlive the process that made them.
    const first = new Database(directory);
    first.savePreset(preset('user.1', 'Persistente'));
    first.close();

    const second = new Database(directory);
    assert.equal(second.listPresets()[0].name, 'Persistente');
    second.close();
  });

  await suite.check('a project takes the place of the photograph it came from', async () => {
    // The whole point of the link: once the work exists, offering the untouched
    // picture in the recent list is offering to start again.
    const db = fresh();
    db.rememberFile('/foto.jpg');
    db.rememberProject('/foto.jpg', '/foto.myphoto');
    db.forgetFile('/foto.jpg');
    db.rememberFile('/foto.myphoto');

    assert.deepEqual(db.recentFiles(), ['/foto.myphoto']);
    assert.equal(db.projectFor('/foto.jpg'), '/foto.myphoto');
    db.close();
  });

  await suite.check('a photograph with no project reports none', async () => {
    const db = fresh();
    assert.equal(db.projectFor('/nunca-editada.jpg'), null);
    db.close();
  });

  await suite.check('saving again moves the link rather than adding one', async () => {
    const db = fresh();
    db.rememberProject('/foto.jpg', '/antigo.myphoto');
    db.rememberProject('/foto.jpg', '/novo.myphoto');
    assert.equal(db.projectFor('/foto.jpg'), '/novo.myphoto');
    db.close();
  });

  rmSync(directory, { recursive: true, force: true });
  return suite.report();
}
