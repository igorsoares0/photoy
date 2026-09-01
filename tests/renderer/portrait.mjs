import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/portrait.ts');

/** A face looking straight at the camera, centred, eyes a fifth of the frame apart. */
function frontal(overrides = {}) {
  return {
    x: 0.35, y: 0.2, width: 0.3, height: 0.4, score: 0.95,
    rightEye: { x: 0.45, y: 0.35 },
    leftEye: { x: 0.55, y: 0.35 },
    nose: { x: 0.5, y: 0.42 },
    rightMouth: { x: 0.46, y: 0.5 },
    leftMouth: { x: 0.54, y: 0.5 },
    ...overrides,
  };
}

const at = (mask, width, x, y) => mask[Math.round(y * 64) * width + Math.round(x * width)];

export async function run() {
  const suite = createSuite('portrait regions');
  const P = await import(`file://${source}`);
  const W = 64;
  const H = 64;

  await suite.check('the face angle follows the eye line', async () => {
    assert.equal(P.faceAngle(frontal()), 0);
    // Head tilted so the subject's left eye sits lower in the frame.
    const tilted = frontal({ leftEye: { x: 0.55, y: 0.45 } });
    assert.ok(P.faceAngle(tilted) > 0.5);
  });

  await suite.check('the eye span is the unit everything else is built from', async () => {
    assert.ok(Math.abs(P.eyeSpan(frontal()) - 0.1) < 1e-9);
  });

  await suite.check('the skin region covers the cheeks', async () => {
    const mask = P.skinMask([frontal()], W, H);
    // Below the eyes, beside the nose: cheek.
    assert.ok(at(mask, W, 0.45, 0.44) > 200, 'the cheek is not covered');
  });

  await suite.check('the skin region cuts out the eyes and the mouth', async () => {
    // The failure that makes retouching look like plastic: smoothing the eyes
    // along with the skin.
    const mask = P.skinMask([frontal()], W, H);
    assert.ok(at(mask, W, 0.45, 0.35) < 40, `the eye is covered (${at(mask, W, 0.45, 0.35)})`);
    assert.ok(at(mask, W, 0.5, 0.5) < 40, `the mouth is covered (${at(mask, W, 0.5, 0.5)})`);
  });

  await suite.check('the skin region leaves the background alone', async () => {
    const mask = P.skinMask([frontal()], W, H);
    assert.equal(at(mask, W, 0.05, 0.05), 0);
    assert.equal(at(mask, W, 0.95, 0.9), 0);
  });

  await suite.check('the region has no hard edge', async () => {
    // A linear ramp leaves a visible crease; the test is that the boundary is
    // a gradient at all rather than a step.
    const mask = P.skinMask([frontal()], W, H);
    const values = [];
    for (let y = 0; y < H; y += 1) values.push(mask[y * W + Math.round(0.5 * W)]);
    const partial = values.filter((v) => v > 10 && v < 245).length;
    assert.ok(partial >= 4, `only ${partial} partial rows, so the edge is hard`);
  });

  await suite.check('the eye region sits on both eyes and nowhere else', async () => {
    const mask = P.eyesMask([frontal()], W, H);
    assert.ok(at(mask, W, 0.45, 0.35) > 200);
    assert.ok(at(mask, W, 0.55, 0.35) > 200);
    assert.ok(at(mask, W, 0.5, 0.5) < 20, 'the mouth is treated as an eye');
  });

  await suite.check('two faces both get covered', async () => {
    const second = frontal({
      rightEye: { x: 0.15, y: 0.35 }, leftEye: { x: 0.25, y: 0.35 },
      rightMouth: { x: 0.16, y: 0.5 }, leftMouth: { x: 0.24, y: 0.5 },
    });
    const mask = P.eyesMask([frontal(), second], W, H);
    assert.ok(at(mask, W, 0.45, 0.35) > 200);
    assert.ok(at(mask, W, 0.15, 0.35) > 200);
  });

  await suite.check('teeth keep the bright pale pixels and drop the lips', async () => {
    // The whole point of the colour filter: geometry cannot tell a tooth from
    // the lip beside it, and whitening a lip is the mistake to avoid.
    const tooth = () => ({ luma: 0.7, saturation: 0.1 });
    const lip = () => ({ luma: 0.45, saturation: 0.65 });
    const all = P.teethMask([frontal()], W, H, tooth);
    const none = P.teethMask([frontal()], W, H, lip);
    const mouth = at(all, W, 0.5, 0.5);
    assert.ok(mouth > 200, `teeth not kept (${mouth})`);
    assert.ok(at(none, W, 0.5, 0.5) < 20, 'lips were kept');
  });

  await suite.check('a closed mouth yields almost nothing', async () => {
    // Correct rather than a shortcoming: there is nothing there to whiten.
    const closed = () => ({ luma: 0.3, saturation: 0.5 });
    const mask = P.teethMask([frontal()], W, H, closed);
    const total = mask.reduce((sum, v) => sum + v, 0);
    assert.ok(total < 255 * 4, `a closed mouth produced coverage (${total})`);
  });

  await suite.check('strength scales a tool and zero is neutral', async () => {
    assert.deepEqual(P.toolAdjustments('skin', 0), { denoise: 0, denoiseDetail: 35, clarity: -0 });
    const half = P.toolAdjustments('skin', 50);
    const full = P.toolAdjustments('skin', 100);
    assert.ok(half.denoise > 0 && half.denoise < full.denoise);
  });

  await suite.check('teeth are desaturated more than they are brightened', async () => {
    // Brightening first would grey the whole mouth before the yellow left.
    const teeth = P.toolAdjustments('teeth', 100);
    assert.ok(Math.abs(teeth.saturation) > teeth.brightness * 2);
  });

  await suite.check('auto is conservative on every tool', async () => {
    // A portrait that has obviously been retouched is the worse photograph.
    for (const [tool, value] of Object.entries(P.AUTO_STRENGTHS)) {
      assert.ok(value > 0 && value <= 50, `${tool} is ${value}`);
    }
  });

  return suite.report();
}
