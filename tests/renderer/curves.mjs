import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/curves.ts');

const points = (...pairs) => pairs.map(([x, y]) => ({ x, y }));
const pairs = (curve) => curve.map((point) => [point.x, point.y]);

export async function run() {
  const suite = createSuite('curves (renderer)');
  const C = await import(`file://${source}`);

  await suite.check('the points come back sorted, clamped and spaced', async () => {
    const cleaned = C.sanitise(points([0.8, 0.9], [0.2, 0.3], [0.2004, 0.9]));
    assert.deepEqual(pairs(cleaned), [
      [0, 0],
      // The near-duplicate of 0.2 goes because it is inside the spacing, and
      // the one that survives is the one that was dropped first.
      [0.2, 0.3],
      [0.8, 0.9],
      [1, 1],
    ]);
    // Out of range is clamped rather than dropped, which is what makes a point
    // dragged off the top of the square end up against the top of the square.
    assert.deepEqual(pairs(C.sanitise(points([0.5, 5], [1.4, -0.2]))), [
      [0, 0],
      [0.5, 1],
      [1, 0],
    ]);
  });

  await suite.check('the ends are filled in, and only when they are missing', async () => {
    assert.deepEqual(pairs(C.sanitise(points([0.5, 0.7]))), [[0, 0], [0.5, 0.7], [1, 1]]);
    // A black point someone lifted is a point at x = 0, and it stays lifted.
    assert.deepEqual(pairs(C.sanitise(points([0, 0.2], [1, 0.9]))), [[0, 0.2], [1, 0.9]]);
    assert.deepEqual(C.sanitise([]), []);
  });

  await suite.check('a curve never carries more points than it may', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ x: i / 39, y: i / 39 }));
    assert.ok(C.sanitise(many).length <= C.MAX_CURVE_POINTS);
    // And the ends survive the cap, which is what the two reserved slots buy.
    const capped = C.sanitise(many);
    assert.equal(capped[0].x, 0);
    assert.equal(capped[capped.length - 1].x, 1);
  });

  await suite.check('points on the diagonal are no curve at all', async () => {
    assert.equal(C.isIdentity([]), true);
    assert.equal(C.isIdentity(points([0, 0], [0.5, 0.5], [1, 1])), true);
    assert.equal(C.isIdentity(points([0.5, 0.5001])), true, 'a rounding error is not an edit');
    assert.equal(C.isIdentity(points([0.5, 0.52])), false);
  });

  await suite.check('the curve passes through the points it was given', async () => {
    const curve = points([0.25, 0.4], [0.75, 0.6]);
    assert.ok(Math.abs(C.evaluate(curve, 0.25) - 0.4) < 1e-6);
    assert.ok(Math.abs(C.evaluate(curve, 0.75) - 0.6) < 1e-6);
    assert.ok(Math.abs(C.evaluate(curve, 0) - 0) < 1e-6);
    assert.ok(Math.abs(C.evaluate(curve, 1) - 1) < 1e-6);
  });

  await suite.check('the curve never turns back on itself', async () => {
    // Each of these overshoots under a plain cubic spline: a steep rise into a
    // flat stretch, a flat stretch into a steep rise, and a step.
    const shapes = [
      points([0.05, 0.45], [0.5, 0.5], [0.95, 0.55]),
      points([0.1, 0.02], [0.9, 0.08]),
      points([0.45, 0.05], [0.55, 0.95]),
      points([0.2, 0.5], [0.3, 0.5], [0.8, 0.51]),
    ];
    for (const shape of shapes) {
      const samples = C.sample(shape, 2001);
      for (let i = 1; i < samples.length; i += 1) {
        assert.ok(
          samples[i] >= samples[i - 1] - 1e-9,
          `reversed at ${i / 2000}: ${samples[i - 1]} then ${samples[i]}`,
        );
      }
    }
  });

  await suite.check('the curve stays between the points around it', async () => {
    // Monotone is not quite enough: a spline can be monotone and still swing
    // past a control point on the way to the next one.
    const shape = points([0.3, 0.7], [0.6, 0.72]);
    for (let i = 0; i <= 1000; i += 1) {
      const x = i / 1000;
      const y = C.evaluate(shape, x);
      if (x >= 0.3 && x <= 0.6) {
        assert.ok(y >= 0.7 - 1e-6 && y <= 0.72 + 1e-6, `swung to ${y} at ${x}`);
      }
    }
  });

  await suite.check('a point cannot be dragged through its neighbours', async () => {
    const curve = C.sanitise(points([0.3, 0.4], [0.6, 0.7]));
    // Index 1 is the first interior point; dragging it far right must stop
    // short of index 2 rather than reordering the curve under the hand.
    const moved = C.movePoint(curve, 1, { x: 0.95, y: 0.5 });
    assert.ok(moved[1].x < moved[2].x, 'the point passed its neighbour');
    assert.ok(moved[1].x > 0.5, 'the point barely moved');
  });

  await suite.check('the ends stay on their own edge', async () => {
    const curve = C.sanitise(points([0, 0], [1, 1]));
    // Dragging the black point is how a black point is set: it moves up, not in.
    const lifted = C.movePoint(curve, 0, { x: 0.4, y: 0.25 });
    assert.deepEqual(pairs(lifted)[0], [0, 0.25]);
    const pulled = C.movePoint(curve, 1, { x: 0.4, y: 0.8 });
    assert.deepEqual(pairs(pulled)[1], [1, 0.8]);
  });

  await suite.check('dropping a point where one sits moves that one', async () => {
    const curve = C.sanitise(points([0.5, 0.6]));
    const again = C.addPoint(curve, { x: 0.5, y: 0.2 });
    assert.equal(again.length, curve.length, 'a second point was made at the same tone');
    assert.deepEqual(pairs(again)[1], [0.5, 0.2]);
  });

  await suite.check('removing the last bend leaves no curve behind', async () => {
    const curve = C.sanitise(points([0.5, 0.7]));
    // Back to the identity, and to an empty list rather than to two points that
    // do nothing - which is what keeps the document neutral again.
    assert.deepEqual(C.removePoint(curve, 1), []);
  });

  await suite.check('the ends cannot be removed', async () => {
    const curve = C.sanitise(points([0.3, 0.4], [0.6, 0.7]));
    assert.equal(C.removePoint(curve, 0).length, curve.length);
    assert.equal(C.removePoint(curve, curve.length - 1).length, curve.length);
  });

  await suite.check('a point is grabbed only from within reach', async () => {
    const curve = C.sanitise(points([0.5, 0.7]));
    assert.equal(C.nearestPoint(curve, { x: 0.51, y: 0.69 }, 0.05), 1);
    assert.equal(C.nearestPoint(curve, { x: 0.7, y: 0.2 }, 0.05), -1);
  });

  return suite.report();
}
