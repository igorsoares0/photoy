import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pathsSource = path.resolve(root, 'apps/desktop/electron/ipc/paths.ts');
const cacheSource = path.resolve(root, 'apps/desktop/electron/store/thumbnail-cache.ts');
const databaseSource = path.resolve(root, 'apps/desktop/electron/store/database.ts');

/** A folder with the given files in it, each one byte of nothing in particular. */
function folderWith(names, { ages = {} } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'photoy-folder-'));
  for (const name of names) {
    const full = path.join(directory, name);
    writeFileSync(full, Buffer.alloc(8));
    const age = ages[name];
    if (age !== undefined) {
      const when = new Date(Date.now() - age);
      utimesSync(full, when, when);
    }
  }
  return directory;
}

/**
 * Browsing, marking and batch naming.
 *
 * The listing and the target naming are pure enough to test from plain Node;
 * what needs Electron - the dialogs - is not tested here, and what needs the
 * engine is covered by the engine's own thumbnail suite.
 */
export async function run() {
  const suite = createSuite('library');
  const { listFolder, batchTarget, FOLDER_LIMIT } = await import(`file://${pathsSource}`);
  const { ThumbnailCache } = await import(`file://${cacheSource}`);
  const { Database } = await import(`file://${databaseSource}`);

  await suite.check('a folder lists the photographs and counts the rest', async () => {
    const directory = folderWith(['a.jpg', 'b.NEF', 'c.heic', 'notes.txt', 'work.myphoto']);
    const listed = listFolder(directory, new Set());
    assert.deepEqual(
      listed.entries.map((entry) => entry.name).sort(),
      ['a.jpg', 'b.NEF', 'c.heic'],
    );
    // The project and the text file are counted, not hidden: a folder that
    // silently shows three of its five files reads as one that lost two.
    assert.equal(listed.skipped, 2);
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('a folder comes back newest first', async () => {
    const directory = folderWith(['old.jpg', 'new.jpg', 'middle.jpg'], {
      ages: { 'old.jpg': 900_000, 'middle.jpg': 300_000, 'new.jpg': 1000 },
    });
    const listed = listFolder(directory, new Set());
    assert.deepEqual(
      listed.entries.map((entry) => entry.name),
      ['new.jpg', 'middle.jpg', 'old.jpg'],
    );
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('a subfolder is not walked into', async () => {
    // One level deep on purpose: walking down is what a catalogue does, and the
    // spec says not to build one.
    const directory = folderWith(['top.jpg']);
    mkdirSync(path.join(directory, 'inside'));
    writeFileSync(path.join(directory, 'inside', 'deep.jpg'), Buffer.alloc(8));
    const listed = listFolder(directory, new Set());
    assert.deepEqual(listed.entries.map((entry) => entry.name), ['top.jpg']);
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('a marked path comes back marked', async () => {
    const directory = folderWith(['one.jpg', 'two.jpg']);
    const marked = path.join(directory, 'one.jpg');
    const listed = listFolder(directory, new Set([marked]));
    assert.equal(listed.entries.find((entry) => entry.path === marked).favourite, true);
    assert.equal(listed.entries.find((entry) => entry.path !== marked).favourite, false);
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('a folder that is not there is refused, not empty', async () => {
    assert.throws(
      () => listFolder(path.join(tmpdir(), 'photoy-no-such-folder-xyz'), new Set()),
      /could not be read/i,
    );
  });

  await suite.check('a very large folder is capped rather than refused', async () => {
    assert.ok(FOLDER_LIMIT >= 500, 'the cap should not be reached by an ordinary shoot');
  });

  await suite.check('a batch names each file after its source', async () => {
    assert.equal(batchTarget('C:\\fotos\\praia.NEF', 'D:\\saida', 'jpeg'), path.join('D:\\saida', 'praia.jpg'));
    assert.equal(batchTarget('/x/praia.cr3', '/out', 'png'), path.join('/out', 'praia.png'));
    assert.equal(batchTarget('/x/praia.jpg', '/out', 'tiff'), path.join('/out', 'praia.tif'));
    assert.equal(batchTarget('/x/praia.jpg', '/out', 'webp'), path.join('/out', 'praia.webp'));
  });

  await suite.check('the cache answers only for the exact file it stored', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'photoy-cache-'));
    const cache = new ThumbnailCache(directory);
    const photo = path.join(directory, 'photo.jpg');
    writeFileSync(photo, Buffer.alloc(64, 1));

    assert.equal(cache.read(photo, 256), null, 'a fresh cache answered something');
    cache.write(photo, 256, Buffer.from([1, 2, 3, 4]));
    assert.deepEqual([...cache.read(photo, 256)], [1, 2, 3, 4]);
    // A different size is a different thumbnail, not the same one scaled.
    assert.equal(cache.read(photo, 128), null);

    // The photograph changed, so the thumbnail of it is no longer of it.
    writeFileSync(photo, Buffer.alloc(128, 2));
    assert.equal(cache.read(photo, 256), null, 'a stale thumbnail was served');
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('the cache stays inside its budget', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'photoy-cache-'));
    const cache = new ThumbnailCache(directory);
    const files = [];
    for (let i = 0; i < 8; i += 1) {
      const photo = path.join(directory, `photo-${i}.jpg`);
      writeFileSync(photo, Buffer.alloc(64, i));
      cache.write(photo, 256, Buffer.alloc(1024, i));
      files.push(photo);
    }
    // Four kilobytes of budget against eight kilobytes stored.
    cache.prune(4 * 1024);
    const surviving = files.filter((photo) => cache.read(photo, 256) !== null);
    assert.ok(surviving.length <= 4, `${surviving.length} entries survived a 4 KB budget`);
    assert.ok(surviving.length > 0, 'the whole cache was thrown away');
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('a cache that is deleted costs nothing but time', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'photoy-cache-'));
    const cache = new ThumbnailCache(directory);
    const photo = path.join(directory, 'photo.jpg');
    writeFileSync(photo, Buffer.alloc(64, 1));
    cache.write(photo, 256, Buffer.from([9, 9, 9]));
    cache.clear();
    assert.equal(cache.read(photo, 256), null);
    // And it still works afterwards, which is the part that makes it a cache
    // rather than a store.
    cache.write(photo, 256, Buffer.from([7, 7]));
    assert.deepEqual([...cache.read(photo, 256)], [7, 7]);
    rmSync(directory, { recursive: true, force: true });
  });

  await suite.check('a favourite survives being written and read', async () => {
    const db = new Database(mkdtempSync(path.join(tmpdir(), 'photoy-db-')));
    db.setFavourite('C:\\fotos\\a.jpg', true);
    db.setFavourite('C:\\fotos\\b.jpg', true);
    db.setFavourite('C:\\fotos\\b.jpg', false);
    assert.deepEqual(db.favourites(), ['C:\\fotos\\a.jpg']);
    // Marking twice is not two marks.
    db.setFavourite('C:\\fotos\\a.jpg', true);
    assert.equal(db.favourites().length, 1);
    db.close();
  });

  await suite.check('marks are asked for in one question, not one each', async () => {
    const db = new Database(mkdtempSync(path.join(tmpdir(), 'photoy-db-')));
    db.setFavourite('/a.jpg', true);
    db.setFavourite('/c.jpg', true);
    assert.deepEqual(db.favouritesAmong(['/a.jpg', '/b.jpg', '/c.jpg']).sort(), ['/a.jpg', '/c.jpg']);
    assert.deepEqual(db.favouritesAmong([]), []);
    db.close();
  });

  await suite.check('folders are remembered newest first', async () => {
    const db = new Database(mkdtempSync(path.join(tmpdir(), 'photoy-db-')));
    db.rememberFolder('/um');
    db.rememberFolder('/dois');
    db.rememberFolder('/um');
    assert.deepEqual(db.recentFolders(), ['/um', '/dois']);
    db.forgetFolder('/um');
    assert.deepEqual(db.recentFolders(), ['/dois']);
    db.close();
  });

  return suite.report();
}
