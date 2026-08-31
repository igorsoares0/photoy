import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite, pixelAt } from './harness.mjs';
import { PATCHES, PATCH_SIZE } from '../fixtures/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

/** A store-only zip, enough to forge a project the engine should refuse. */
function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    let crc = ~0;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    crc = ~crc >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('projects');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-project-'));

  const grey = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    const index = PATCHES.findIndex((patch) => patch.name === 'grey');
    return pixelAt(preview.payload, preview.result.stride, index * PATCH_SIZE + PATCH_SIZE / 2, PATCH_SIZE / 2)[0];
  };

  /** An edited document: a rotation, a crop and two adjustment layers. */
  const buildEdited = async (sourcePath) => {
    const { result } = await engine.call('image.open', { path: sourcePath });
    const documentId = result.id;
    const apply = (operation) => engine.call('edit.apply', { documentId, operation });
    await apply({ kind: 'rotate', quarters: 1 });
    await apply({ kind: 'adjust', adjustments: { exposure: 0.7, contrast: 25 } });
    await apply({ kind: 'addLayer', name: 'Segunda' });
    const listed = await engine.call('edit.history', { documentId });
    await apply({ kind: 'adjust', layerId: listed.result.layers[2].id, adjustments: { temperature: 30 } });
    await apply({ kind: 'setLayerOpacity', layerId: listed.result.layers[2].id, opacity: 0.6 });
    return documentId;
  };

  await suite.check('a saved project reopens as the same edit', async () => {
    const documentId = await buildEdited(path.join(fixtures, 'patches.png'));
    const before = await engine.call('edit.history', { documentId });
    const expected = await grey(documentId);

    const target = path.join(workDir, 'round-trip.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    assert.equal(opened.result.image.fileName, 'patches.png');
    assert.equal(opened.result.history.entries.length, before.result.entries.length);
    assert.equal(opened.result.history.layers.length, before.result.layers.length);
    assert.equal(opened.result.image.width, before.result.width);
    assert.equal(opened.result.image.height, before.result.height);
    assert.equal(await grey(opened.result.id), expected, 'the pixels came back different');
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('the original travels inside the project', async () => {
    // A project that only pointed at the photograph would be worthless the
    // moment the photograph moved.
    const copy = path.join(workDir, 'moved.png');
    copyFileSync(path.join(fixtures, 'patches.png'), copy);
    const documentId = await buildEdited(copy);
    const expected = await grey(documentId);

    const target = path.join(workDir, 'embedded.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });
    rmSync(copy);

    const opened = await engine.call('project.open', { path: target });
    assert.equal(await grey(opened.result.id), expected);
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('the redo tail survives a save', async () => {
    const documentId = await buildEdited(path.join(fixtures, 'patches.png'));
    await engine.call('edit.undo', { documentId });
    await engine.call('edit.undo', { documentId });
    const before = await engine.call('edit.history', { documentId });
    assert.equal(before.result.canRedo, true);

    const target = path.join(workDir, 'undone.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    assert.equal(opened.result.history.cursor, before.result.cursor);
    assert.equal(opened.result.history.canRedo, true, 'the redo tail was lost');
    assert.equal(opened.result.history.entries.length, before.result.entries.length);
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('the container is an ordinary zip', async () => {
    // If this application ever fails to open one, the photograph inside should
    // still be one double-click away.
    const documentId = await buildEdited(path.join(fixtures, 'patches.png'));
    const target = path.join(workDir, 'inspect.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const bytes = readFileSync(target);
    assert.equal(bytes.subarray(0, 2).toString('ascii'), 'PK', 'not a zip');
    assert.ok(bytes.includes(Buffer.from('manifest.json')), 'no manifest entry');
    assert.ok(bytes.includes(Buffer.from('original/patches.png')), 'no original entry');
    // Stored, not deflated, so the manifest reads with any tool.
    assert.ok(bytes.includes(Buffer.from('"format": "photoy-project"')), 'manifest is unreadable');
  });

  await suite.check('a file that is not a project is refused clearly', async () => {
    const target = path.join(workDir, 'not-a-project.myphoto');
    writeFileSync(target, 'isto não é um projeto');
    await assert.rejects(() => engine.call('project.open', { path: target }), /file_unreadable/);
  });

  await suite.check('a zip without a manifest is refused', async () => {
    const target = path.join(workDir, 'empty.myphoto');
    writeFileSync(target, makeZip([['readme.txt', Buffer.from('nada aqui')]]));
    await assert.rejects(() => engine.call('project.open', { path: target }), /file_unreadable/);
  });

  await suite.check('a project from a newer version is refused, not half-read', async () => {
    // Opening it would drop whatever the newer version recorded, and the next
    // save would then destroy it.
    const manifest = Buffer.from(
      JSON.stringify({ format: 'photoy-project', version: 99, source: {}, operations: [] }),
    );
    const target = path.join(workDir, 'future.myphoto');
    writeFileSync(target, makeZip([['manifest.json', manifest]]));
    await assert.rejects(() => engine.call('project.open', { path: target }), /unsupported_format/);
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
