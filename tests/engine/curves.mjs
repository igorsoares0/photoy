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
const rendererCurves = path.resolve(root, 'apps/desktop/renderer/src/lib/curves.ts');

const INDEX = Object.fromEntries(PATCHES.map((patch, i) => [patch.name, i]));

/**
 * A curve point list from pairs, so the tests read as the shape they describe.
 *
 * The ends are left out on purpose in most of them: filling them in is the
 * engine's job, and a test that supplied them would never notice if it stopped.
 */
const points = (...pairs) => pairs.map(([x, y]) => ({ x, y }));

/**
 * How far the rendered ramp may sit from the curve the panel would draw.
 *
 * One level, above input level 8. Below that the tone table runs out of
 * resolution: it is sampled evenly in linear light over two stops of headroom,
 * so the darkest levels of the output share a handful of entries, and a curve
 * with a steep slope down there interpolates across them. Measured on a curve
 * that rises nine-fold in the first twentieth: 6.4 levels at input level 1,
 * 2.3 anywhere above level 8, and under 0.7 for any curve of an ordinary shape.
 */
const AGREEMENT = 1;
const AGREEMENT_FROM = 8;

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('curves');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-curves-'));
  const C = await import(`file://${rendererCurves}`);

  const open = async (file = 'patches.png') => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, file) });
    return result.id;
  };

  const adjust = (documentId, adjustments) =>
    engine.call('edit.apply', { documentId, operation: { kind: 'adjust', adjustments } });

  const render = (documentId) =>
    engine.call('image.renderPreview', { documentId, maxWidth: 4000, maxHeight: 4000 });

  /** Reads the centre pixel of each named patch at full size. */
  const patches = async (documentId) => {
    const preview = await render(documentId);
    return (name) =>
      pixelAt(
        preview.payload,
        preview.result.stride,
        INDEX[name] * PATCH_SIZE + PATCH_SIZE / 2,
        PATCH_SIZE / 2,
      );
  };

  /** The rendered neutral ramp, one output level per input level. */
  const ramp = async (curves) => {
    const documentId = await open('ramp.png');
    await adjust(documentId, { curves });
    const preview = await render(documentId);
    const levels = Array.from({ length: 256 }, (_, level) =>
      pixelAt(preview.payload, preview.result.stride, level, 4),
    );
    await engine.call('image.close', { documentId });
    return levels;
  };

  await suite.check('a curve through the diagonal changes nothing', async () => {
    const documentId = await open();
    const before = await patches(documentId);
    // Three points, all on y = x. A curve tool that treated any point list as a
    // reason to build a table would still pass this; what it checks is that the
    // response through those points is the line they sit on.
    await adjust(documentId, { curves: { rgb: points([0, 0], [0.5, 0.5], [1, 1]) } });
    const after = await patches(documentId);
    for (const name of ['black', 'dark', 'grey', 'light', 'white', 'red']) {
      assert.deepEqual(after(name), before(name), `${name} moved`);
    }
    await engine.call('image.close', { documentId });
  });

  await suite.check('the engine renders the curve the panel drew', async () => {
    // The interpolation exists twice - once in C++ to render the photograph and
    // once in TypeScript to draw the panel - so this is the check that they are
    // the same curve. A neutral ramp is the fixture because a grey survives the
    // trip to the working space and back, which leaves the tone response as the
    // only thing between the two numbers.
    for (const shape of [
      points([0.5, 0.75]),
      points([0.25, 0.15], [0.75, 0.85]),
      points([0, 0.15], [1, 0.9]),
    ]) {
      const levels = await ramp({ rgb: shape });
      const spline = C.compile(shape);
      for (let level = AGREEMENT_FROM; level < 256; level += 1) {
        const expected = 255 * spline.at(level / 255);
        assert.ok(
          Math.abs(levels[level][0] - expected) <= AGREEMENT,
          `level ${level}: engine ${levels[level][0]}, panel ${expected.toFixed(2)}`,
        );
      }
    }
  });

  await suite.check('a lifted midpoint lands where it was put', async () => {
    const documentId = await open();
    // Neutral grey survives the trip to the working space and back, so a
    // control point at (0.5, 0.75) has to come out at 0.75 of full scale. The
    // input patch is 128, which is 0.502 - one level above the point.
    await adjust(documentId, { curves: { rgb: points([0.5, 0.75]) } });
    const read = await patches(documentId);
    const grey = read('grey');
    assert.ok(Math.abs(grey[0] - 191) <= 2, `expected the midpoint near 191, got ${grey[0]}`);
    assert.deepEqual(read('black'), [0, 0, 0, 255], 'black moved');
    assert.deepEqual(read('white'), [255, 255, 255, 255], 'white moved');
    await engine.call('image.close', { documentId });
  });

  await suite.check('the ends are the ends, wherever the points stop', async () => {
    const documentId = await open();
    // One point, nowhere near either end. Everything outside it is still
    // defined, and defined as the identity rather than as a flat extension of
    // the point - a curve that flattened would turn white grey here.
    await adjust(documentId, { curves: { rgb: points([0.25, 0.4]) } });
    const read = await patches(documentId);
    assert.deepEqual(read('black'), [0, 0, 0, 255]);
    assert.deepEqual(read('white'), [255, 255, 255, 255]);
    assert.ok(read('dark')[0] > 64, 'the point below the midtones did nothing');
    await engine.call('image.close', { documentId });
  });

  await suite.check('the same shape on all three channels is the master curve', async () => {
    // Which is the only way to state what "per channel" means without asserting
    // a number that the working space's own primaries decide.
    const shape = points([0.35, 0.5], [0.8, 0.7]);
    const master = await open();
    await adjust(master, { curves: { rgb: shape } });
    const viaMaster = await patches(master);

    const channels = await open();
    await adjust(channels, { curves: { red: shape, green: shape, blue: shape } });
    const viaChannels = await patches(channels);

    for (const name of ['black', 'dark', 'grey', 'light', 'white', 'red', 'blue', 'muted']) {
      assert.deepEqual(viaChannels(name), viaMaster(name), `${name} differs`);
    }
    await engine.call('image.close', { documentId: master });
    await engine.call('image.close', { documentId: channels });
  });

  await suite.check('a channel curve moves its own channel hardest', async () => {
    // The curves act in the working space, whose primaries are far wider than
    // anything a screen shows, so lifting red also drags the other two - by
    // design, and the same way the saturation and hue controls do. Measured on
    // this fixture: grey 128 becomes 237,106,127. What the check holds is the
    // part that is a decision rather than a consequence - that the red curve is
    // the one that moved red, and that green and blue did not go up with it.
    const documentId = await open();
    await adjust(documentId, { curves: { red: points([0.5, 0.75]) } });
    const grey = (await patches(documentId))('grey');
    assert.ok(grey[0] > 200, `red barely moved: ${grey[0]}`);
    assert.ok(grey[1] < 128 && grey[2] < 128, `the other channels rose too: ${grey.join(',')}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('the master curve runs before the channel curves', async () => {
    // The order is a decision, so it gets a check rather than a comment. Both
    // curves are put on all three channels, which keeps the ramp neutral and
    // leaves the composition as the only thing being measured.
    const master = points([0.5, 0.75]);
    const channel = points([0.5, 0.25]);
    const first = C.compile(master);
    const second = C.compile(channel);
    const sample = 128 / 255;
    const composed = 255 * second.at(first.at(sample));
    const reversed = 255 * first.at(second.at(sample));
    assert.ok(Math.abs(composed - reversed) > 8, 'the two orders are indistinguishable here');

    const levels = await ramp({ rgb: master, red: channel, green: channel, blue: channel });
    assert.ok(
      Math.abs(levels[128][0] - composed) <= AGREEMENT,
      `expected ${composed.toFixed(1)} (master first), got ${levels[128][0]}; ` +
        `the other order would be ${reversed.toFixed(1)}`,
    );
  });

  await suite.check('the curve never turns back on itself', async () => {
    // Points a plain cubic spline overshoots on: a steep rise into a long flat
    // stretch. Overshoot here would mean a tone that goes up and then back
    // down, which reads on a photograph as a dark band inside a bright area.
    const levels = await ramp({ rgb: points([0.05, 0.45], [0.5, 0.5], [0.95, 0.55]) });
    for (let level = 1; level < 256; level += 1) {
      assert.ok(
        levels[level][0] >= levels[level - 1][0],
        `reversed at ${level}: ${levels[level - 1][0]} then ${levels[level][0]}`,
      );
    }
  });

  await suite.check('a curve composes with the sliders', async () => {
    const documentId = await open();
    await adjust(documentId, { contrast: 40 });
    const withSlider = (await patches(documentId))('dark')[0];
    await adjust(documentId, { contrast: 40, curves: { rgb: points([0.25, 0.45]) } });
    const withBoth = (await patches(documentId))('dark')[0];
    assert.ok(withBoth > withSlider, `the curve did nothing on top of contrast: ${withBoth}`);
    await engine.call('image.close', { documentId });
  });

  await suite.check('points are cleaned on the way in', async () => {
    const documentId = await open();
    await adjust(documentId, {
      curves: {
        // Out of order, out of range, duplicated in x, and more of them than a
        // curve may carry. All of it is the caller's mistake to make and the
        // engine's to absorb.
        rgb: points([0.5, 0.75], [0.1, 0.2], [0.5, 0.1], [-1, 2], [3, -1]).concat(
          Array.from({ length: 20 }, (_, i) => ({ x: 0.6 + i * 0.01, y: 0.6 + i * 0.01 })),
        ),
      },
    });
    const { result } = await engine.call('edit.history', { documentId });
    const stored = result.adjustments.curves.rgb;
    assert.ok(stored.length <= 16, `kept ${stored.length} points`);
    for (let i = 1; i < stored.length; i += 1) {
      assert.ok(stored[i].x > stored[i - 1].x, 'the points came back unsorted or doubled');
    }
    for (const point of stored) {
      assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1, 'a point escaped');
    }
    assert.equal(stored[0].x, 0, 'the low end was not filled in');
    assert.equal(stored[stored.length - 1].x, 1, 'the high end was not filled in');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a curve survives a project round trip', async () => {
    const documentId = await open();
    await adjust(documentId, { curves: { rgb: points([0.5, 0.75]), blue: points([0.5, 0.3]) } });
    const expected = (await patches(documentId))('grey');

    const target = path.join(workDir, 'curved.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const opened = await engine.call('project.open', { path: target });
    const reopened = (await patches(opened.result.id))('grey');
    assert.deepEqual(reopened, expected, 'the curve did not come back');
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('a document with an identity curve is still neutral', async () => {
    // Neutrality is what lets the renderer skip the whole per-pixel pass, so a
    // curve that does nothing must not cost anything either.
    const documentId = await open();
    const before = await patches(documentId);
    await adjust(documentId, { curves: { rgb: points([0, 0], [1, 1]) } });
    const after = await patches(documentId);
    assert.deepEqual(after('grey'), before('grey'));
    assert.deepEqual(after('red'), before('red'));
    await engine.call('image.close', { documentId });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
