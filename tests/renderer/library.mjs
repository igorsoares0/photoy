import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/library.ts');

const entry = (name, favourite = false) => ({
  path: `C:\\fotos\\${name}`,
  name,
  size: 1000,
  modified: 0,
  favourite,
});

export async function run() {
  const suite = createSuite('library (renderer)');
  const L = await import(`file://${source}`);

  const entries = [
    entry('praia-01.jpg'),
    entry('PRAIA-02.jpg', true),
    entry('montanha.NEF'),
    entry('retrato.heic', true),
  ];

  await suite.check('no filter returns the very same list', async () => {
    // Identity, not equality: a selector that built a new array every call
    // would make the store look changed on every render, and this codebase has
    // been caught in that loop three times.
    const same = L.filterEntries(entries, { query: '', onlyFavourites: false });
    assert.equal(same, entries);
    assert.equal(L.filterEntries(entries, { query: '   ', onlyFavourites: false }), entries);
  });

  await suite.check('a search matches anywhere in the name, any case', async () => {
    const found = L.filterEntries(entries, { query: 'praia', onlyFavourites: false });
    assert.deepEqual(found.map((e) => e.name), ['praia-01.jpg', 'PRAIA-02.jpg']);
    assert.deepEqual(
      L.filterEntries(entries, { query: '.NEF', onlyFavourites: false }).map((e) => e.name),
      ['montanha.NEF'],
    );
    assert.deepEqual(L.filterEntries(entries, { query: 'nada', onlyFavourites: false }), []);
  });

  await suite.check('the mark filter and the search compose', async () => {
    assert.deepEqual(
      L.filterEntries(entries, { query: '', onlyFavourites: true }).map((e) => e.name),
      ['PRAIA-02.jpg', 'retrato.heic'],
    );
    assert.deepEqual(
      L.filterEntries(entries, { query: 'praia', onlyFavourites: true }).map((e) => e.name),
      ['PRAIA-02.jpg'],
    );
  });

  await suite.check('a path is shortened to the folder it is in', async () => {
    assert.equal(L.shorten('C:\\fotos\\2026\\praia'), '2026 / praia');
    assert.equal(L.shorten('/home/ana/fotos'), 'ana / fotos');
    // Nothing to shorten is left alone rather than turned into an empty label.
    assert.equal(L.shorten('praia'), 'praia');
    assert.equal(L.shorten(''), '');
  });

  await suite.check('a file name is read with either separator', async () => {
    assert.equal(L.fileName('C:\\fotos\\praia-01.jpg'), 'praia-01.jpg');
    assert.equal(L.fileName('/home/ana/praia-01.jpg'), 'praia-01.jpg');
    assert.equal(L.fileName('praia-01.jpg'), 'praia-01.jpg');
  });

  return suite.report();
}
