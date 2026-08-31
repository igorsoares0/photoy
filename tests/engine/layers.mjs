import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

const INDEX = Object.fromEntries(PATCHES.map((patch, i) => [patch.name, i]));

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('layers');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-layers-'));

  const open = async () => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, 'patches.png') });
    return result.id;
  };
  const apply = (documentId, operation) => engine.call('edit.apply', { documentId, operation });
  const grey = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    return pixelAt(
      preview.payload,
      preview.result.stride,
      INDEX.grey * PATCH_SIZE + PATCH_SIZE / 2,
      PATCH_SIZE / 2,
    )[0];
  };

  await suite.check('a fresh document is nothing but its background', async () => {
    const documentId = await open();
    const { result } = await engine.call('edit.history', { documentId });
    assert.equal(result.layers.length, 1);
    assert.equal(result.layers[0].kind, 'background');
    await engine.call('image.close', { documentId });
  });

  await suite.check('an adjustment creates the layer it needs', async () => {
    // Layers should not be something you have to think about to change a slider.
    const documentId = await open();
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1 } });
    const { result } = await engine.call('edit.history', { documentId });
    assert.equal(result.layers.length, 2);
    assert.equal(result.layers[1].kind, 'adjustment');
    assert.ok(Math.abs(result.layers[1].adjustments.exposure - 1) < 1e-5);
    await engine.call('image.close', { documentId });
  });

  await suite.check('the background cannot be removed', async () => {
    const documentId = await open();
    const { result } = await engine.call('edit.history', { documentId });
    await apply(documentId, { kind: 'removeLayer', layerId: result.layers[0].id });
    const after = await engine.call('edit.history', { documentId });
    assert.equal(after.result.layers.length, 1);
    assert.equal(after.result.layers[0].kind, 'background');
    await engine.call('image.close', { documentId });
  });

  await suite.check('two layers stack on top of one another', async () => {
    const documentId = await open();
    const plain = await grey(documentId);

    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 0.5 } });
    const one = await grey(documentId);

    await apply(documentId, { kind: 'addLayer', name: 'Segunda' });
    const listed = await engine.call('edit.history', { documentId });
    assert.equal(listed.result.layers.length, 3);
    await apply(documentId, {
      kind: 'adjust',
      layerId: listed.result.layers[2].id,
      adjustments: { exposure: 0.5 },
    });
    const two = await grey(documentId);

    assert.ok(one > plain + 5, 'the first layer did nothing');
    assert.ok(two > one + 5, 'the second layer did nothing');
    await engine.call('image.close', { documentId });
  });

  await suite.check('hiding a layer removes its effect exactly', async () => {
    const documentId = await open();
    const plain = await grey(documentId);
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1 } });
    const { result } = await engine.call('edit.history', { documentId });
    const layerId = result.layers[1].id;

    await apply(documentId, { kind: 'setLayerVisible', layerId, visible: false });
    assert.equal(await grey(documentId), plain, 'hidden should mean absent');

    await apply(documentId, { kind: 'setLayerVisible', layerId, visible: true });
    assert.ok(await grey(documentId) > plain + 20, 'showing it again did nothing');
    await engine.call('image.close', { documentId });
  });

  await suite.check('opacity lands the result between the two states', async () => {
    // A stop is a doubling of linear light, so half opacity has an arithmetic
    // answer: one and a half times, not somewhere in the middle of the slider.
    const toLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    const expected = Math.round(toSrgb(toLinear(128 / 255) * 1.5) * 255);

    const documentId = await open();
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1 } });
    const { result } = await engine.call('edit.history', { documentId });
    await apply(documentId, { kind: 'setLayerOpacity', layerId: result.layers[1].id, opacity: 0.5 });

    const actual = await grey(documentId);
    assert.ok(Math.abs(actual - expected) <= 2, `expected ~${expected}, read ${actual}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('multiply darkens and screen lightens', async () => {
    for (const [mode, direction] of [['multiply', -1], ['screen', 1]]) {
      const documentId = await open();
      const plain = await grey(documentId);
      // A neutral layer is not a no-op once it blends: the mode itself is what
      // does the work.
      await apply(documentId, { kind: 'adjust', adjustments: {} });
      const { result } = await engine.call('edit.history', { documentId });
      await apply(documentId, { kind: 'setLayerBlend', layerId: result.layers[1].id, blend: mode });

      const blended = await grey(documentId);
      assert.ok(
        direction > 0 ? blended > plain + 20 : blended < plain - 20,
        `${mode} moved grey from ${plain} to ${blended}`,
      );
      await engine.call('image.close', { documentId });
    }
  });

  await suite.check('order matters, and reordering changes the result', async () => {
    // Exposure is linear and contrast is not, so swapping them is visible.
    const build = async (first, second) => {
      const documentId = await open();
      await apply(documentId, { kind: 'adjust', adjustments: first });
      await apply(documentId, { kind: 'addLayer', name: 'topo' });
      const { result } = await engine.call('edit.history', { documentId });
      await apply(documentId, {
        kind: 'adjust',
        layerId: result.layers[2].id,
        adjustments: second,
      });
      const value = await grey(documentId);
      await engine.call('image.close', { documentId });
      return value;
    };
    const a = await build({ exposure: 0.8 }, { contrast: 70 });
    const b = await build({ contrast: 70 }, { exposure: 0.8 });
    assert.notEqual(a, b, 'the two orders produced the same pixel');
  });

  await suite.check('reordering moves a layer within the stack', async () => {
    const documentId = await open();
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 0.8 } });
    await apply(documentId, { kind: 'addLayer', name: 'topo' });
    const listed = await engine.call('edit.history', { documentId });
    const top = listed.result.layers[2];
    await apply(documentId, { kind: 'adjust', layerId: top.id, adjustments: { contrast: 70 } });
    const before = await grey(documentId);

    await apply(documentId, { kind: 'reorderLayer', layerId: top.id, index: 1 });
    const reordered = await engine.call('edit.history', { documentId });
    assert.equal(reordered.result.layers[1].id, top.id, 'the layer did not move');
    assert.notEqual(await grey(documentId), before, 'moving it changed nothing');
    await engine.call('image.close', { documentId });
  });

  await suite.check('an export composites the whole stack', async () => {
    const documentId = await open();
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 0.6 } });
    await apply(documentId, { kind: 'addLayer', name: 'topo' });
    const listed = await engine.call('edit.history', { documentId });
    await apply(documentId, {
      kind: 'adjust',
      layerId: listed.result.layers[2].id,
      adjustments: { contrast: 40 },
    });
    const expected = await grey(documentId);

    const target = path.join(workDir, 'stack.png');
    await engine.call('image.export', { documentId, path: target, format: 'png' });
    const reopened = await engine.call('image.open', { path: target });
    const actual = await grey(reopened.result.id);

    assert.ok(Math.abs(actual - expected) <= 2, `preview ${expected}, export ${actual}`);
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
