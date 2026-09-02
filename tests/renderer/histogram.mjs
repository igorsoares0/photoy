import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/histogram.ts');

/**
 * An RGBA frame from a function of x and y, with a stride wider than the row.
 *
 * The padding is deliberate: the engine pads its rows, and a reader that
 * assumed four bytes times the width would shear the picture and skew every
 * count with it.
 */
function frame(width, height, pixel, padding = 12) {
  const stride = width * 4 + padding;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const at = y * stride + x * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = a;
    }
  }
  return { pixels, width, height, stride };
}

const total = (bins) => bins.reduce((sum, count) => sum + count, 0);

export async function run() {
  const suite = createSuite('histogram');
  const H = await import(`file://${source}`);

  const measure = (made) => H.measure(made.pixels, made.width, made.height, made.stride);

  await suite.check('a flat grey lands in one bin', async () => {
    const counted = measure(frame(64, 64, () => [128, 128, 128, 255]));
    assert.equal(counted.red[128], counted.counted);
    assert.equal(counted.green[128], counted.counted);
    assert.equal(counted.blue[128], counted.counted);
    assert.equal(counted.luma[128], counted.counted);
    assert.equal(total(counted.red), counted.counted);
    assert.equal(counted.peak, counted.counted);
  });

  await suite.check('the row padding is not counted as picture', async () => {
    // The padding is zeroed, so a reader that walked it would pile a quarter of
    // the frame onto black - and would report black clipping on a grey square.
    const counted = measure(frame(50, 20, () => [200, 200, 200, 255], 40));
    assert.equal(counted.red[0], 0, 'the padding leaked into the count');
    assert.equal(counted.clippedShadows, 0);
    assert.equal(counted.red[200], counted.counted);
  });

  await suite.check('a transparent area is not part of the picture', async () => {
    // After a background removal the whole cut-out would otherwise pile onto
    // black and report the photograph as half crushed.
    const counted = measure(frame(64, 64, (x) => (x < 32 ? [90, 90, 90, 255] : [0, 0, 0, 0])));
    assert.equal(counted.red[0], 0);
    assert.equal(counted.red[90], counted.counted);
    assert.equal(counted.clippedShadows, 0);
  });

  await suite.check('clipping is counted per channel', async () => {
    // A blown red in a sunset is lost detail even where green and blue still
    // have room, so this must not wait for all three.
    const counted = measure(frame(64, 64, () => [255, 100, 40, 255]));
    assert.equal(counted.clippedHighlights, 1);
    assert.equal(counted.clippedShadows, 0);

    const black = measure(frame(64, 64, () => [0, 0, 0, 255]));
    assert.equal(black.clippedShadows, 1);
    // Black is not a blown highlight, whatever the channel count says.
    assert.equal(black.clippedHighlights, 0);
  });

  await suite.check('half a frame clipped is reported as half', async () => {
    const counted = measure(frame(64, 64, (x) => (x < 32 ? [255, 255, 255, 255] : [128, 128, 128, 255])));
    assert.ok(Math.abs(counted.clippedHighlights - 0.5) < 0.02, `${counted.clippedHighlights}`);
  });

  await suite.check('luma weights green heaviest', async () => {
    // Rec.709: pure green reads far brighter than pure blue, which is the whole
    // reason a luma histogram is not the average of three numbers.
    const green = measure(frame(32, 32, () => [0, 255, 0, 255]));
    const blue = measure(frame(32, 32, () => [0, 0, 255, 255]));
    const greenLevel = green.luma.findIndex((count) => count > 0);
    const blueLevel = blue.luma.findIndex((count) => count > 0);
    assert.ok(greenLevel > 170, `green read as ${greenLevel}`);
    assert.ok(blueLevel < 30, `blue read as ${blueLevel}`);
  });

  await suite.check('an empty frame counts nothing rather than dividing by zero', async () => {
    const counted = H.measure(new Uint8Array(0), 0, 0, 0);
    assert.equal(counted.counted, 0);
    assert.equal(counted.peak, 0);
    assert.equal(counted.clippedShadows, 0);
    assert.equal(counted.clippedHighlights, 0);
    assert.equal(H.channelPath(counted.luma, counted.peak), '');
  });

  await suite.check('the drawn path spans the square and closes', async () => {
    const counted = measure(frame(64, 64, (x) => [x * 4, x * 4, x * 4, 255]));
    const drawn = H.channelPath(counted.luma, counted.peak);
    assert.ok(drawn.startsWith('M 0 1'), drawn.slice(0, 20));
    assert.ok(drawn.endsWith('L 1 1 Z'), drawn.slice(-20));
    // One point per bin, plus the two that close the shape against the floor.
    assert.equal(drawn.split('L').length - 1, H.HISTOGRAM_BINS + 1);
  });

  await suite.check('the tallest bin reaches the top and nothing passes it', async () => {
    const counted = measure(frame(64, 64, (x) => [x < 48 ? 20 : 220, x < 48 ? 20 : 220, x < 48 ? 20 : 220, 255]));
    const drawn = H.channelPath(counted.luma, counted.peak);
    const heights = drawn
      .split('L')
      .slice(1, -1)
      .map((part) => Number(part.trim().split(/\s+/)[1]));
    assert.ok(Math.min(...heights) >= 0, 'a bin was drawn above the square');
    assert.ok(Math.abs(Math.min(...heights)) < 1e-9, 'the tallest bin did not reach the top');
    assert.ok(Math.max(...heights) <= 1 + 1e-9, 'a bin was drawn below the floor');
  });

  return suite.report();
}
