import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/viewport.ts');

/**
 * Geometry the crop tool depends on.
 *
 * These are pure functions, so they are worth testing directly: the aspect-ratio
 * bug that shipped here only showed up by driving the real UI, which is a slow
 * and unreliable way to find arithmetic mistakes.
 */
export async function run() {
  const suite = createSuite('renderer geometry');
  const { placeDocument, toScreen, toDocument, clampRect, applyAspect } = await import(
    `file://${source}`
  );

  const viewport = { width: 1000, height: 600 };
  const document = { width: 2000, height: 1000 };

  await suite.check('a fitted document is centred in the viewport', async () => {
    const placement = placeDocument(viewport, document, 0.4, 0, 0);
    assert.equal(placement.left, (1000 - 800) / 2);
    assert.equal(placement.top, (600 - 400) / 2);
  });

  await suite.check('screen and document coordinates are inverses', async () => {
    const placement = placeDocument(viewport, document, 0.4, 37, -19);
    for (const [x, y] of [[0, 0], [1999, 999], [640, 480]]) {
      const screen = toScreen(placement, x, y);
      const back = toDocument(placement, screen.x, screen.y);
      assert.ok(Math.abs(back.x - x) < 1e-6 && Math.abs(back.y - y) < 1e-6, `${x},${y} drifted`);
    }
  });

  await suite.check('clamping moves a rectangle in rather than shrinking it', async () => {
    // Size is preserved where it fits and the position gives way, so dragging a
    // crop past the edge slides it back instead of collapsing it.
    const clamped = clampRect({ x: -50, y: 900, width: 2500, height: 400 }, document);
    assert.deepEqual(clamped, { x: 0, y: 600, width: 2000, height: 400 });
    assert.equal(clamped.height, 400, 'a height that fits should survive untouched');
  });

  await suite.check('an aspect ratio fits inside the rectangle, never outside it', async () => {
    // Growing to the larger candidate is what made a locked ratio silently stop
    // being honoured: the clamp to the document bounds undid it.
    const square = applyAspect({ x: 0, y: 0, width: 2400, height: 1600 }, 1, 0, 0);
    assert.equal(square.width, 1600);
    assert.equal(square.height, 1600);
    assert.ok(square.width <= 2400 && square.height <= 1600, 'the result grew');
  });

  await suite.check('an aspect ratio survives the clamp that follows it', async () => {
    for (const aspect of [1, 4 / 3, 3 / 2, 16 / 9]) {
      const shaped = applyAspect({ x: 0, y: 0, width: 2000, height: 1000 }, aspect, 0, 0);
      const clamped = clampRect(shaped, document);
      const actual = clamped.width / clamped.height;
      assert.ok(
        Math.abs(actual - aspect) < 0.01,
        `expected ${aspect.toFixed(3)}, kept ${actual.toFixed(3)}`,
      );
    }
  });

  await suite.check('the anchor corner stays put', async () => {
    const rect = { x: 100, y: 200, width: 900, height: 600 };
    // Anchored top-left: x and y do not move.
    const topLeft = applyAspect(rect, 1, rect.x, rect.y);
    assert.equal(topLeft.x, 100);
    assert.equal(topLeft.y, 200);

    // Anchored bottom-right: the far edges do not move.
    const bottomRight = applyAspect(rect, 1, -1, -1);
    assert.equal(bottomRight.x + bottomRight.width, rect.x + rect.width);
    assert.equal(bottomRight.y + bottomRight.height, rect.y + rect.height);
  });

  return suite.report();
}
