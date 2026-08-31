import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/brush.ts');

/** The arithmetic behind the mask brush, away from the pointer that drives it. */
export async function run() {
  const suite = createSuite('brush geometry');
  const { brushMaskSize, brushRadius, strokePoints, coverageFromRgba, MAX_BRUSH_SIDE } =
    await import(`file://${source}`);

  await suite.check('a small document is painted at its own size', async () => {
    assert.deepEqual(brushMaskSize(800, 600), { width: 800, height: 600 });
  });

  await suite.check('a large document is capped, keeping its shape', async () => {
    // Otherwise a stroke on a 24 MP photograph sends 24 MB to the engine to
    // describe an edge that is soft anyway.
    const size = brushMaskSize(6000, 4000);
    assert.equal(size.width, MAX_BRUSH_SIDE);
    assert.equal(size.height, Math.round((MAX_BRUSH_SIDE * 4000) / 6000));
  });

  await suite.check('a document with no size paints nothing', async () => {
    assert.deepEqual(brushMaskSize(0, 0), { width: 0, height: 0 });
  });

  await suite.check('the radius is a share of the shorter side', async () => {
    // The unit every other mask here uses, so a brush means the same thing on a
    // phone snapshot and on a scan.
    assert.equal(brushRadius(10, 1000, 500), 25);
    assert.equal(brushRadius(10, 500, 1000), 25);
  });

  await suite.check('a radius is never zero', async () => {
    assert.ok(brushRadius(0, 1000, 1000) > 0);
  });

  await suite.check('a fast drag is filled in rather than left dotted', async () => {
    // A pointer reports where it is, not where it went.
    const points = strokePoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    assert.ok(points.length > 20, `only ${points.length} stamps across 100 px`);
    assert.deepEqual(points.at(-1), { x: 100, y: 0 });
  });

  await suite.check('consecutive stamps overlap', async () => {
    const radius = 10;
    const points = strokePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, radius);
    for (let i = 1; i < points.length; i += 1) {
      const gap = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      assert.ok(gap < radius, `gap of ${gap} for a radius of ${radius}`);
    }
  });

  await suite.check('a stroke that did not move stamps once', async () => {
    assert.deepEqual(strokePoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 10), [{ x: 5, y: 5 }]);
  });

  await suite.check('a very long stroke is bounded', async () => {
    // A hairline brush dragged across a large canvas must not try to stamp a
    // hundred thousand times inside one pointer event.
    const points = strokePoints({ x: 0, y: 0 }, { x: 100000, y: 0 }, 0.5);
    assert.ok(points.length <= 2000, `${points.length} stamps`);
  });

  await suite.check('coverage comes from the alpha channel', async () => {
    // The brush paints white on transparent, so alpha is the coverage; reading
    // the colour instead would make an erased pixel look fully covered.
    const rgba = new Uint8ClampedArray([255, 255, 255, 0, 255, 255, 255, 128, 255, 255, 255, 255]);
    assert.deepEqual(Array.from(coverageFromRgba(rgba, 3)), [0, 128, 255]);
  });

  return suite.report();
}
