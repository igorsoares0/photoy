import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite } from '../engine/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../apps/desktop/renderer/src/lib/enhance.ts');
const types = path.resolve(here, '../../packages/types/src/edit.ts');

/**
 * The rules that turn a measurement into a proposal.
 *
 * These are judgements, and a judgement worth making is worth pinning down: the
 * point of testing them is less that they are right than that changing one is
 * visible rather than accidental.
 */
export async function run() {
  const suite = createSuite('enhancement proposals');
  const { proposeEnhancements, applySuggestions, percentile, share } = await import(
    `file://${source}`
  );
  const { NEUTRAL_ADJUSTMENTS } = await import(`file://${types}`);

  /** A histogram with `pixels` spread over the given levels. */
  const at = (levels, pixels = 100000) => {
    const histogram = new Array(256).fill(0);
    const each = Math.floor(pixels / levels.length);
    for (const level of levels) histogram[level] += each;
    return { histogram, pixels: each * levels.length };
  };
  const analysis = (over, extra = {}) => ({
    documentId: 'doc-1',
    ...over,
    channelMean: [0.5, 0.5, 0.5],
    chromaMean: 0.3,
    detail: 0.05,
    ...extra,
  });
  const ids = (list) => list.map((entry) => entry.id);

  await suite.check('a percentile finds the level a fraction falls below', async () => {
    const { histogram, pixels } = at([10, 20, 30, 200]);
    assert.equal(percentile(histogram, pixels, 0.5), 20);
    assert.equal(percentile(histogram, pixels, 0.99), 200);
  });

  await suite.check('a share counts a band of the histogram', async () => {
    const { histogram, pixels } = at([10, 10, 200, 200]);
    assert.ok(Math.abs(share(histogram, pixels, 0, 50) - 0.5) < 1e-6);
  });

  await suite.check('a picture with nothing wrong gets nothing proposed', async () => {
    // Middle grey, full range, colour present, detail present.
    const spread = [];
    for (let level = 2; level < 254; level += 1) spread.push(level);
    const proposals = proposeEnhancements(analysis(at(spread)));
    assert.deepEqual(ids(proposals), [], `proposed ${ids(proposals).join(', ')}`);
  });

  await suite.check('a dark picture is offered light', async () => {
    const proposals = proposeEnhancements(analysis(at([20, 24, 28, 32])));
    const light = proposals.find((entry) => entry.id === 'light');
    assert.ok(light !== undefined, 'no light proposal');
    assert.ok(light.delta.exposure > 0, 'proposed to make it darker still');
  });

  await suite.check('a bright picture is offered less light', async () => {
    const proposals = proposeEnhancements(analysis(at([200, 210, 220, 230])));
    const light = proposals.find((entry) => entry.id === 'light');
    assert.ok(light !== undefined && light.delta.exposure < 0);
  });

  await suite.check('exposure is never proposed beyond a stop and a half', async () => {
    // The measurement can say a picture is eight stops dark; acting on that
    // would be an assertion, not a suggestion.
    const proposals = proposeEnhancements(analysis(at([1, 1, 2, 2])));
    const light = proposals.find((entry) => entry.id === 'light');
    assert.ok(light.delta.exposure <= 1.5, `proposed ${light.delta.exposure} EV`);
  });

  await suite.check('shadows are offered only when there is something in them', async () => {
    // Dark but not crushed: there is detail down there to lift.
    const present = proposeEnhancements(analysis(at([5, 10, 20, 30, 120, 200])));
    assert.ok(ids(present).includes('shadows'));

    // Crushed to black: lifting would only turn the blacks grey.
    const crushed = { histogram: new Array(256).fill(0), pixels: 100000 };
    crushed.histogram[0] = 50000;
    crushed.histogram[128] = 50000;
    assert.ok(!ids(proposeEnhancements(analysis(crushed))).includes('shadows'));
  });

  await suite.check('highlights are offered only when they are not blown', async () => {
    const recoverable = { histogram: new Array(256).fill(0), pixels: 100000 };
    recoverable.histogram[240] = 20000;
    recoverable.histogram[100] = 80000;
    assert.ok(ids(proposeEnhancements(analysis(recoverable))).includes('highlights'));

    const blown = { histogram: new Array(256).fill(0), pixels: 100000 };
    blown.histogram[255] = 40000;
    blown.histogram[100] = 60000;
    assert.ok(!ids(proposeEnhancements(analysis(blown))).includes('highlights'));
  });

  await suite.check('a flat picture is offered contrast', async () => {
    const proposals = proposeEnhancements(analysis(at([100, 110, 120, 130])));
    const contrast = proposals.find((entry) => entry.id === 'contrast');
    assert.ok(contrast !== undefined && contrast.delta.contrast > 0);
  });

  await suite.check('a warm cast is cooled and a cool one warmed', async () => {
    const spread = [];
    for (let level = 2; level < 254; level += 1) spread.push(level);
    const warm = proposeEnhancements(analysis(at(spread), { channelMean: [0.6, 0.5, 0.45] }));
    const cool = proposeEnhancements(analysis(at(spread), { channelMean: [0.45, 0.5, 0.6] }));
    assert.ok(warm.find((e) => e.id === 'cast').delta.temperature < 0, 'a warm cast was warmed');
    assert.ok(cool.find((e) => e.id === 'cast').delta.temperature > 0, 'a cool cast was cooled');
  });

  await suite.check('a mild cast is left alone', async () => {
    // A warm evening is not a fault, and this cannot tell one from the other.
    const spread = [];
    for (let level = 2; level < 254; level += 1) spread.push(level);
    const proposals = proposeEnhancements(analysis(at(spread), { channelMean: [0.52, 0.5, 0.49] }));
    assert.ok(!ids(proposals).includes('cast'));
  });

  await suite.check('a colourless picture is offered vibrance, not saturation', async () => {
    const spread = [];
    for (let level = 2; level < 254; level += 1) spread.push(level);
    const proposals = proposeEnhancements(analysis(at(spread), { chromaMean: 0.02 }));
    const colour = proposals.find((entry) => entry.id === 'colour');
    assert.ok(colour !== undefined);
    assert.equal(colour.delta.saturation, undefined, 'saturation would blow out what is already vivid');
    assert.ok(colour.delta.vibrance > 0);
  });

  await suite.check('a soft picture is offered detail', async () => {
    const spread = [];
    for (let level = 2; level < 254; level += 1) spread.push(level);
    const proposals = proposeEnhancements(analysis(at(spread), { detail: 0.002 }));
    assert.ok(proposals.find((entry) => entry.id === 'detail').delta.sharpen > 0);
  });

  await suite.check('an empty picture proposes nothing rather than dividing by zero', async () => {
    assert.deepEqual(
      proposeEnhancements(analysis({ histogram: new Array(256).fill(0), pixels: 0 })),
      [],
    );
  });

  await suite.check('only what is ticked is applied', async () => {
    const suggestions = [
      { id: 'light', delta: { exposure: 0.5 }, measure: 0 },
      { id: 'contrast', delta: { contrast: 20 }, measure: 0 },
    ];
    const result = applySuggestions(NEUTRAL_ADJUSTMENTS, suggestions, new Set(['light']));
    assert.equal(result.exposure, 0.5);
    assert.equal(result.contrast, 0, 'an unticked proposal was applied');
  });

  await suite.check('a proposal adds to what is already there', async () => {
    // The proposal is an improvement on the picture as it stands, not a verdict
    // that replaces the work already done to it.
    const current = { ...NEUTRAL_ADJUSTMENTS, contrast: 10 };
    const suggestions = [{ id: 'contrast', delta: { contrast: 20 }, measure: 0 }];
    const result = applySuggestions(current, suggestions, new Set(['contrast']));
    assert.equal(result.contrast, 30);
  });

  await suite.check('ticking nothing changes nothing', async () => {
    const suggestions = [{ id: 'light', delta: { exposure: 0.5 }, measure: 0 }];
    assert.deepEqual(applySuggestions(NEUTRAL_ADJUSTMENTS, suggestions, new Set()), NEUTRAL_ADJUSTMENTS);
  });

  return suite.report();
}
