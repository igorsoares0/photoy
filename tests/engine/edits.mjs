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

/** The magenta block the gradient fixture paints at x 40-89, y 20-59. */
const BLOCK = { x: 40, y: 20, width: 50, height: 40 };
const MAGENTA = [255, 0, 255, 255];

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('edit stack and jobs');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-edits-'));

  /** Opens a fresh document so each test starts from an empty stack. */
  const openGradient = async () => {
    const { result } = await engine.call('image.open', {
      path: path.join(fixtures, 'gradient.png'),
    });
    return result.id;
  };

  const render = (documentId, maxWidth = 4000, maxHeight = 4000) =>
    engine.call('image.renderPreview', { documentId, maxWidth, maxHeight });

  const apply = (documentId, operation) =>
    engine.call('edit.apply', { documentId, operation });

  await suite.check('a rotation swaps the reported dimensions', async () => {
    const documentId = await openGradient();
    const { result } = await apply(documentId, { kind: 'rotate', quarters: 1 });
    assert.equal(result.width, 120);
    assert.equal(result.height, 200);

    const preview = await render(documentId);
    assert.equal(preview.result.documentWidth, 120);
    assert.equal(preview.result.documentHeight, 200);
    assert.equal(preview.result.width, 120);
    await engine.call('image.close', { documentId });
  });

  await suite.check('four quarter turns come back to the original', async () => {
    const documentId = await openGradient();
    const before = await render(documentId);
    for (let i = 0; i < 4; i += 1) await apply(documentId, { kind: 'rotate', quarters: 1 });
    const after = await render(documentId);

    assert.equal(after.result.width, before.result.width);
    assert.equal(after.result.height, before.result.height);
    assert.deepEqual(after.payload, before.payload, 'pixels drifted over four turns');
    await engine.call('image.close', { documentId });
  });

  await suite.check('two quarter turns equal one half turn', async () => {
    // The stack folds to a single orientation, so these have to be identical
    // pixel for pixel rather than merely similar.
    const twice = await openGradient();
    await apply(twice, { kind: 'rotate', quarters: 1 });
    await apply(twice, { kind: 'rotate', quarters: 1 });
    const a = await render(twice);

    const once = await openGradient();
    await apply(once, { kind: 'rotate', quarters: 2 });
    const b = await render(once);

    assert.deepEqual(a.payload, b.payload);
    await engine.call('image.close', { documentId: twice });
    await engine.call('image.close', { documentId: once });
  });

  await suite.check('flipping twice is a no-op', async () => {
    const documentId = await openGradient();
    const before = await render(documentId);
    await apply(documentId, { kind: 'flipHorizontal' });
    await apply(documentId, { kind: 'flipHorizontal' });
    const after = await render(documentId);
    assert.deepEqual(after.payload, before.payload);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a horizontal and a vertical flip equal a half turn', async () => {
    const flipped = await openGradient();
    await apply(flipped, { kind: 'flipHorizontal' });
    await apply(flipped, { kind: 'flipVertical' });
    const a = await render(flipped);

    const rotated = await openGradient();
    await apply(rotated, { kind: 'rotate', quarters: 2 });
    const b = await render(rotated);

    assert.deepEqual(a.payload, b.payload);
    await engine.call('image.close', { documentId: flipped });
    await engine.call('image.close', { documentId: rotated });
  });

  await suite.check('a crop keeps exactly the requested region', async () => {
    const documentId = await openGradient();
    const { result } = await apply(documentId, { kind: 'crop', rect: BLOCK });
    assert.equal(result.width, BLOCK.width);
    assert.equal(result.height, BLOCK.height);

    const preview = await render(documentId);
    for (const [x, y] of [[0, 0], [BLOCK.width - 1, 0], [0, BLOCK.height - 1], [25, 20]]) {
      assert.deepEqual(
        pixelAt(preview.payload, preview.result.stride, x, y),
        MAGENTA,
        `pixel ${x},${y} is outside the cropped block`,
      );
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('a crop after a rotation is read in the rotated frame', async () => {
    // The user crops what they can see, so the rectangle arrives in displayed
    // coordinates and has to be mapped back through the rotation.
    const documentId = await openGradient();
    await apply(documentId, { kind: 'rotate', quarters: 1 });

    // Rotating 200x120 clockwise puts the block at x 60-99, y 40-89.
    const rotatedBlock = { x: 60, y: 40, width: 40, height: 50 };
    const { result } = await apply(documentId, { kind: 'crop', rect: rotatedBlock });
    assert.equal(result.width, rotatedBlock.width);
    assert.equal(result.height, rotatedBlock.height);

    const preview = await render(documentId);
    for (const [x, y] of [[0, 0], [39, 0], [0, 49], [20, 25]]) {
      assert.deepEqual(
        pixelAt(preview.payload, preview.result.stride, x, y),
        MAGENTA,
        `pixel ${x},${y} is outside the rotated crop`,
      );
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('the same crop renders the same content at any resolution', async () => {
    const documentId = await openGradient();
    await apply(documentId, { kind: 'crop', rect: { x: 100, y: 0, width: 100, height: 120 } });

    const full = await render(documentId, 4000, 4000);
    const small = await render(documentId, 25, 30);
    assert.equal(full.result.width, 100);
    assert.equal(small.result.width, 25);

    // The same relative position has to land on the same colour, give or take
    // the averaging the downscale does.
    const a = pixelAt(full.payload, full.result.stride, 50, 60);
    const b = pixelAt(small.payload, small.result.stride, 12, 15);
    a.forEach((value, index) => {
      assert.ok(Math.abs(value - b[index]) <= 6, `channel ${index}: ${value} vs ${b[index]}`);
    });
    await engine.call('image.close', { documentId });
  });

  await suite.check('a crop that falls outside the image is refused', async () => {
    const documentId = await openGradient();
    await assert.rejects(
      () => apply(documentId, { kind: 'crop', rect: { x: 500, y: 500, width: 10, height: 10 } }),
      /invalid_request/,
    );
    // The document is untouched, not half-edited.
    const history = await engine.call('edit.history', { documentId });
    assert.equal(history.result.entries.length, 0);
    assert.equal(history.result.width, 200);
    await engine.call('image.close', { documentId });
  });

  await suite.check('undo and redo move along the history without copying pixels', async () => {
    const documentId = await openGradient();
    await apply(documentId, { kind: 'rotate', quarters: 1 });

    const undone = await engine.call('edit.undo', { documentId });
    assert.equal(undone.result.width, 200);
    assert.equal(undone.result.cursor, 0);
    assert.equal(undone.result.canUndo, false);
    assert.equal(undone.result.canRedo, true);
    assert.equal(undone.result.entries.length, 1, 'the undone entry is kept for redo');

    const redone = await engine.call('edit.redo', { documentId });
    assert.equal(redone.result.width, 120);
    assert.equal(redone.result.cursor, 1);
    assert.equal(redone.result.canRedo, false);
    await engine.call('image.close', { documentId });
  });

  await suite.check('editing after an undo drops the redo tail', async () => {
    const documentId = await openGradient();
    await apply(documentId, { kind: 'rotate', quarters: 1 });
    await engine.call('edit.undo', { documentId });

    const { result } = await apply(documentId, { kind: 'flipHorizontal' });
    assert.equal(result.entries.length, 1, 'the abandoned branch was kept');
    assert.equal(result.entries[0].kind, 'flipHorizontal');
    assert.equal(result.canRedo, false);
    await engine.call('image.close', { documentId });
  });

  await suite.check('reset returns the document to the original', async () => {
    const documentId = await openGradient();
    await apply(documentId, { kind: 'rotate', quarters: 1 });
    await apply(documentId, { kind: 'crop', rect: { x: 0, y: 0, width: 50, height: 50 } });

    const { result } = await engine.call('edit.reset', { documentId });
    assert.equal(result.entries.length, 0);
    assert.equal(result.width, 200);
    assert.equal(result.height, 120);
    await engine.call('image.close', { documentId });
  });

  await suite.check('export writes the edited image, not the original', async () => {
    const documentId = await openGradient();
    await apply(documentId, { kind: 'rotate', quarters: 1 });
    await apply(documentId, { kind: 'crop', rect: { x: 0, y: 0, width: 60, height: 90 } });

    const target = path.join(workDir, 'edited.png');
    const { result } = await engine.call('image.export', { documentId, path: target, format: 'png' });
    assert.equal(result.width, 60);
    assert.equal(result.height, 90);

    const reopened = await engine.call('image.open', { path: target });
    assert.equal(reopened.result.image.width, 60);
    assert.equal(reopened.result.image.height, 90);
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId });
  });

  await suite.check('a superseded render is cancelled instead of finishing', async () => {
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'large.png') });
    const documentId = opened.result.id;

    // Everything shares one coalescing key, the way a dragged slider would.
    const inFlight = [];
    for (let i = 0; i < 10; i += 1) {
      inFlight.push(
        engine.request(
          'image.renderPreview',
          { documentId, maxWidth: 2600 - i, maxHeight: 1800 },
          `preview:${documentId}`,
        ),
      );
    }
    const settled = await Promise.all(inFlight);

    const cancelled = settled.filter(
      ({ header }) => header.ok === false && header.error.code === 'cancelled',
    );
    assert.ok(cancelled.length > 0, 'no render was superseded');
    assert.equal(
      settled[settled.length - 1].header.ok,
      true,
      'the most recent render should be the one that survives',
    );
    // Every request is answered exactly once, cancelled or not.
    assert.equal(settled.length, 10);
    await engine.call('image.close', { documentId });
  });

  await suite.check('a job can be cancelled by id while it runs', async () => {
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'large.png') });
    const documentId = opened.result.id;

    const pending = engine.request('image.renderPreview', {
      documentId,
      maxWidth: 2600,
      maxHeight: 1800,
    });
    const cancel = await engine.call('job.cancel', { jobId: pending.jobId });
    assert.equal(cancel.result.cancelled, true, 'the job was already gone');

    const { header } = await pending;
    assert.equal(header.ok, false);
    assert.equal(header.error.code, 'cancelled');
    await engine.call('image.close', { documentId });
  });

  await suite.check('the reader keeps answering while a render is in flight', async () => {
    // This is the whole point of the queue: a cancel arriving during a long
    // render has to be seen, which means the reading thread cannot be busy.
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'large.png') });
    const documentId = opened.result.id;

    const heavy = engine.request('image.renderPreview', {
      documentId,
      maxWidth: 2600,
      maxHeight: 1800,
    });
    const described = await engine.call('engine.describe');
    assert.equal(described.result.name, 'photoy-engine');

    await heavy;
    await engine.call('image.close', { documentId });
  });

  await suite.check('jobs report their lifecycle as events', async () => {
    const states = engine.events
      .filter((event) => event.event === 'job.state')
      .map((event) => event.data.state);
    assert.ok(states.includes('running'), 'no running event was emitted');
    assert.ok(states.includes('completed'), 'no completed event was emitted');
    assert.ok(states.includes('cancelled'), 'no cancelled event was emitted');
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
