import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/preview.ts');

/**
 * The policy behind how large a preview to ask for.
 *
 * Worth testing away from the canvas: it is the only decision in the render
 * loop, it has three reasons to say no, and getting the draft case wrong would
 * leave a soft picture on screen after the hand came off the slider.
 */
export async function run() {
  const suite = createSuite('preview sizing');
  const { previewTarget, DRAFT_SCALE } = await import(`file://${source}`);

  const base = {
    documentWidth: 4000,
    documentHeight: 3000,
    scale: 0.25,
    devicePixelRatio: 1,
    interacting: false,
    rendered: 0,
    forced: true,
  };

  await suite.check('a preview matches the pixels actually on screen', async () => {
    const target = previewTarget(base);
    assert.equal(target.width, 1000);
    assert.equal(target.height, 750);
  });

  await suite.check('a preview never exceeds the document', async () => {
    // Zooming in does not create detail that is not there.
    const target = previewTarget({ ...base, scale: 4 });
    assert.equal(target.width, 4000);
  });

  await suite.check('the megapixel budget caps a very large document', async () => {
    const target = previewTarget({
      ...base, documentWidth: 20000, documentHeight: 15000, scale: 1,
    });
    // The height is rounded up to hold the aspect ratio, so the budget can be
    // exceeded by at most that single row and by nothing else.
    assert.ok(
      target.width * target.height <= 24_000_000 + target.width,
      `${target.width} x ${target.height}`,
    );
    assert.ok(target.width < 20000);
  });

  await suite.check('a drag asks for the draft scale', async () => {
    const target = previewTarget({ ...base, interacting: true });
    assert.equal(target.width, Math.round(1000 * DRAFT_SCALE));
    assert.equal(target.height, Math.ceil((target.width * 3000) / 4000));
  });

  await suite.check('releasing goes back to full size', async () => {
    // The point of the whole thing: the frame that ends the gesture is the one
    // rendered in full, so a soft picture is never what is left behind.
    const drafted = previewTarget({ ...base, interacting: true });
    const released = previewTarget({ ...base, rendered: drafted.width, forced: true });
    assert.equal(released.width, 1000);
  });

  await suite.check('a nudge of the zoom is not worth a round trip', async () => {
    assert.equal(previewTarget({ ...base, rendered: 1030, forced: false }), null);
  });

  await suite.check('a real zoom change is', async () => {
    assert.notEqual(previewTarget({ ...base, rendered: 500, forced: false }), null);
  });

  await suite.check('an edit re-renders even at the same size', async () => {
    // The size did not move but the pixels did, which is what forced means.
    const target = previewTarget({ ...base, rendered: 1000, forced: true });
    assert.equal(target.width, 1000);
  });

  await suite.check('the first frame of a drag is not skipped as too similar', async () => {
    // Half of 1000 is 500, nowhere near the tenth that would suppress it - but
    // this is the case that would strand a full-size frame if the draft scale
    // ever crept close to 1.
    const target = previewTarget({ ...base, interacting: true, rendered: 1000, forced: false });
    assert.notEqual(target, null);
  });

  await suite.check('a document with no size asks for nothing', async () => {
    assert.equal(previewTarget({ ...base, documentWidth: 0, documentHeight: 0 }), null);
  });

  return suite.report();
}
