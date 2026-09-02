import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite, pixelAt } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('straighten');
  const engine = new EngineClient(enginePath);

  const open = async (file) => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, file) });
    return result;
  };
  const apply = (documentId, operation) => engine.call('edit.apply', { documentId, operation });
  const render = async (documentId, side = 4000) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: side, maxHeight: side,
    });
    const { width, height, stride } = preview.result;
    return {
      width,
      height,
      at: (fx, fy) =>
        pixelAt(preview.payload, stride, Math.round(fx * (width - 1)), Math.round(fy * (height - 1))),
    };
  };

  await suite.check('describe lists straighten among the operations', async () => {
    const { result } = await engine.call('engine.describe');
    assert.ok(result.operations.includes('straighten'));
  });

  await suite.check('an angle of zero changes nothing at all', async () => {
    const { id } = await open('gradient.png');
    const before = await render(id);
    await apply(id, { kind: 'straighten', angle: 0 });
    const after = await render(id);
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);
    assert.deepEqual(after.at(0.3, 0.4), before.at(0.3, 0.4));
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('the frame shrinks and keeps its shape', async () => {
    const { id } = await open('gradient.png');
    const { result } = await apply(id, { kind: 'straighten', angle: 10 });
    assert.ok(result.width < 200, `the frame did not shrink: ${result.width}`);
    assert.ok(result.height < 120);
    // Same aspect ratio as the photograph: levelling a horizon must not change
    // the shape of the picture.
    const before = 200 / 120;
    const after = result.width / result.height;
    assert.ok(Math.abs(after - before) < 0.02, `${before} became ${after}`);
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('the trim matches the arithmetic, not a guess', async () => {
    // A 200x120 frame turned by 10 degrees: the largest same-shape rectangle
    // that still fits is scaled by min(w/(w cos + h sin), h/(w sin + h cos)),
    // which is 0.8253 here.
    const { id } = await open('gradient.png');
    const { result } = await apply(id, { kind: 'straighten', angle: 10 });
    const radians = (10 * Math.PI) / 180;
    const scale = Math.min(
      200 / (200 * Math.cos(radians) + 120 * Math.sin(radians)),
      120 / (200 * Math.sin(radians) + 120 * Math.cos(radians)),
    );
    assert.ok(Math.abs(result.width - Math.floor(200 * scale)) <= 1, `${result.width}`);
    assert.ok(Math.abs(result.height - Math.floor(120 * scale)) <= 1, `${result.height}`);
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('a positive angle turns the photograph clockwise, by the angle asked for', async () => {
    /*
     * The tilt fixture has one black mark forty pixels to the right of centre
     * and level with it. Turning the photograph twenty degrees clockwise has to
     * put that mark at (40 cos 20, 40 sin 20) from the centre of the new frame -
     * right and down. This is the check that pins the sign of the angle, and it
     * pins the amount at the same time.
     */
    const { id } = await open('tilt.png');
    await apply(id, { kind: 'straighten', angle: 20 });
    const preview = await engine.call('image.renderPreview', {
      documentId: id, maxWidth: 4000, maxHeight: 4000,
    });
    const { width, height, stride } = preview.result;

    let sumX = 0;
    let sumY = 0;
    let dark = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (preview.payload[y * stride + x * 4] < 100) {
          sumX += x;
          sumY += y;
          dark += 1;
        }
      }
    }
    assert.ok(dark > 200, `the mark did not survive the turn: ${dark} pixels`);

    const radians = (20 * Math.PI) / 180;
    const offsetX = sumX / dark - (width - 1) / 2;
    const offsetY = sumY / dark - (height - 1) / 2;
    assert.ok(
      Math.abs(offsetX - 40 * Math.cos(radians)) < 1.5,
      `across: ${offsetX.toFixed(2)}, expected ${(40 * Math.cos(radians)).toFixed(2)}`,
    );
    assert.ok(
      Math.abs(offsetY - 40 * Math.sin(radians)) < 1.5,
      `down: ${offsetY.toFixed(2)}, expected ${(40 * Math.sin(radians)).toFixed(2)}`,
    );
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('the angle is absolute, not accumulated', async () => {
    const { id } = await open('gradient.png');
    const once = await apply(id, { kind: 'straighten', angle: 8 });
    // Dragging a slider sends a stream of these. If each one trimmed the frame
    // again the picture would shrink to nothing under the hand.
    await apply(id, { kind: 'straighten', angle: 3 });
    const back = await apply(id, { kind: 'straighten', angle: 8 });
    assert.equal(back.result.width, once.result.width);
    assert.equal(back.result.height, once.result.height);
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('undoing a straighten puts the frame back', async () => {
    const { id } = await open('gradient.png');
    await apply(id, { kind: 'straighten', angle: 12 });
    const undone = await engine.call('edit.undo', { documentId: id });
    assert.equal(undone.result.width, 200);
    assert.equal(undone.result.height, 120);
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('a straightened photograph has no empty corners', async () => {
    // The frame is inscribed, so every pixel of the result comes from the
    // photograph. A corner that went transparent would mean it did not.
    const { id } = await open('gradient.png');
    await apply(id, { kind: 'straighten', angle: 15 });
    const frame = await render(id);
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5]]) {
      assert.equal(frame.at(fx, fy)[3], 255, `corner ${fx},${fy} came back transparent`);
    }
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('a crop after a straighten keeps the angle and fits inside', async () => {
    const { id } = await open('gradient.png');
    const levelled = await apply(id, { kind: 'straighten', angle: 12 });
    const { width, height } = levelled.result;
    const cropped = await apply(id, {
      kind: 'crop',
      rect: {
        x: Math.round(width * 0.2),
        y: Math.round(height * 0.2),
        width: Math.round(width * 0.5),
        height: Math.round(height * 0.5),
      },
    });
    assert.ok(Math.abs(cropped.result.width - Math.round(width * 0.5)) <= 2, `${cropped.result.width}`);

    // Still turned, still full: a crop that fell outside the picture would show
    // as transparent corners.
    const frame = await render(id);
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      assert.equal(frame.at(fx, fy)[3], 255, `corner ${fx},${fy} left the photograph`);
    }
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('a straighten travels through a resize and a quarter turn', async () => {
    const { id } = await open('gradient.png');
    await apply(id, { kind: 'straighten', angle: 10 });
    await apply(id, { kind: 'rotate', quarters: 1 });
    const resized = await apply(id, { kind: 'resize', width: 90, height: 150 });
    assert.equal(resized.result.width, 90);
    assert.equal(resized.result.height, 150);
    const frame = await render(id);
    assert.equal(frame.at(0, 0)[3], 255);
    assert.equal(frame.at(1, 1)[3], 255);
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('an angle beyond the limit is clamped, not refused', async () => {
    const { id } = await open('gradient.png');
    const far = await apply(id, { kind: 'straighten', angle: 400 });
    const limit = await apply(id, { kind: 'straighten', angle: 45 });
    assert.equal(far.result.width, limit.result.width);
    await engine.call('image.close', { documentId: id });
  });

  await suite.check('a straighten survives an export', async () => {
    const { id } = await open('gradient.png');
    const levelled = await apply(id, { kind: 'straighten', angle: 14 });
    const { tmpdir } = await import('node:os');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-straighten-'));
    const target = path.join(workDir, 'levelled.png');
    await engine.call('image.export', { documentId: id, path: target, format: 'png' });

    const reopened = await engine.call('image.open', { path: target });
    assert.equal(reopened.result.image.width, levelled.result.width);
    assert.equal(reopened.result.image.height, levelled.result.height);
    await engine.call('image.close', { documentId: reopened.result.id });
    await engine.call('image.close', { documentId: id });
    rmSync(workDir, { recursive: true, force: true });
  });

  engine.close();
  return suite.report();
}
