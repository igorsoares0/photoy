import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite, pixelAt } from './harness.mjs';
import { SUBJECT_WIDTH, SUBJECT_HEIGHT } from '../fixtures/generate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('local inference');
  const engine = new EngineClient(enginePath);
  const workDir = mkdtempSync(path.join(tmpdir(), 'photoy-ai-'));

  const open = async () => {
    const { result } = await engine.call('image.open', { path: path.join(fixtures, 'subject.png') });
    return result.id;
  };
  const apply = (documentId, operation) => engine.call('edit.apply', { documentId, operation });

  /** Reads the rendered pixel at a fraction of the frame. */
  const sample = async (documentId) => {
    const preview = await engine.call('image.renderPreview', {
      documentId, maxWidth: 4000, maxHeight: 4000,
    });
    const { width, height, stride } = preview.result;
    return (fx, fy) =>
      pixelAt(preview.payload, stride, Math.floor(fx * (width - 1)), Math.floor(fy * (height - 1)))[0];
  };

  await suite.check('describe reports the models and their licences', async () => {
    const { result } = await engine.call('engine.describe');
    const model = result.models.find((entry) => entry.id === 'segmentation');
    assert.ok(model !== undefined, 'no segmentation model listed');
    // The licence is reported because it is a shipping constraint, not trivia.
    assert.equal(model.license, 'Apache-2.0');
    assert.equal(model.available, true, `model missing: ${JSON.stringify(model)}`);
    assert.equal(model.loaded, false, 'nothing should be resident before it is asked for');
  });

  await suite.check('describe reports what the machine could compute on', async () => {
    // Machine-dependent, so the assertions are about shape and consistency
    // rather than about this particular graphics card.
    const { result } = await engine.call('engine.describe');
    assert.ok(result.compute, 'no compute section');
    assert.ok(['cpu', 'directml'].includes(result.compute.running));
    assert.ok(['cpu', 'directml'].includes(result.compute.available));
    assert.ok(Array.isArray(result.compute.adapters));
  });

  await suite.check('the usable adapters are listed before the rest', async () => {
    // A caller taking the front of the list has to get the best one, and the
    // difference is not academic: on the machine this was built on, the
    // integrated adapter spent sixty-five seconds compiling shaders to run the
    // segmentation model 1.3 times faster, while the discrete one ran it ten
    // times faster after two.
    const { result } = await engine.call('engine.describe');
    const usable = result.compute.adapters.map((adapter) => adapter.usable);
    assert.deepEqual([...usable].sort((a, b) => Number(b) - Number(a)), usable);
  });

  await suite.check('an adapter is only called usable when it has memory of its own', async () => {
    const { result } = await engine.call('engine.describe');
    for (const adapter of result.compute.adapters) {
      if (adapter.usable) {
        assert.ok(adapter.memory >= 2 * 1024 * 1024 * 1024, `${adapter.name} has ${adapter.memory}`);
      }
    }
  });

  await suite.check('the engine says it runs on the processor', async () => {
    // Not an implementation detail: the DirectML path was built and measured,
    // and it does not pay for itself. If this ever changes it should change
    // deliberately, with this test as the place that notices.
    const { result } = await engine.call('engine.describe');
    assert.equal(result.compute.running, 'cpu');
  });

  await suite.check('segmentation finds the subject and loads the model on demand', async () => {
    const documentId = await open();
    const { result } = await engine.call('ai.segment', { documentId });
    assert.ok(result.raster > 0, 'no mask was produced');
    assert.equal(result.width, SUBJECT_WIDTH);
    assert.equal(result.height, SUBJECT_HEIGHT);

    const described = await engine.call('engine.describe');
    const model = described.result.models.find((entry) => entry.id === 'segmentation');
    assert.equal(model.loaded, true, 'the model should be resident after being used');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a generated mask confines its layer to the subject', async () => {
    const documentId = await open();
    const before = await sample(documentId);
    const backgroundBefore = before(0.06, 0.12);
    const subjectBefore = before(0.46, 0.33);

    const segmented = await engine.call('ai.segment', { documentId });
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1.5 } });
    const listed = await engine.call('edit.history', { documentId });
    await apply(documentId, {
      kind: 'setLayerMask',
      layerId: listed.result.layers[1].id,
      mask: {
        kind: 'raster',
        raster: segmented.result.raster,
        rasterWidth: segmented.result.width,
        rasterHeight: segmented.result.height,
      },
    });

    const after = await sample(documentId);
    assert.ok(
      after(0.46, 0.33) > subjectBefore + 20,
      `the subject should be lit: ${subjectBefore} -> ${after(0.46, 0.33)}`,
    );
    assert.ok(
      Math.abs(after(0.06, 0.12) - backgroundBefore) <= 6,
      `the background should be left alone: ${backgroundBefore} -> ${after(0.06, 0.12)}`,
    );
    await engine.call('image.close', { documentId });
  });

  await suite.check('a mask made for another shape is dropped, not stretched', async () => {
    // Cropping moves every pixel under the mask. Rendering it anyway would be
    // quietly wrong, so the engine leaves it out and says so.
    const documentId = await open();
    const segmented = await engine.call('ai.segment', { documentId });
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1.5 } });
    const listed = await engine.call('edit.history', { documentId });
    await apply(documentId, {
      kind: 'setLayerMask',
      layerId: listed.result.layers[1].id,
      mask: {
        kind: 'raster',
        raster: segmented.result.raster,
        rasterWidth: segmented.result.width,
        rasterHeight: segmented.result.height,
      },
    });
    const masked = await sample(documentId);
    const backgroundMasked = masked(0.06, 0.12);

    await apply(documentId, { kind: 'crop', rect: { x: 0, y: 0, width: 500, height: 400 } });
    const cropped = await sample(documentId);
    // With the mask gone the layer applies everywhere, so the background lifts.
    assert.ok(
      cropped(0.06, 0.12) > backgroundMasked + 20,
      'the stale mask was still being applied',
    );

    const history = await engine.call('edit.history', { documentId });
    const mask = history.result.layers[1].mask;
    assert.equal(mask.kind, 'raster');
    assert.notEqual(mask.rasterWidth, history.result.width, 'the sizes should disagree');
    await engine.call('image.close', { documentId });
  });

  await suite.check('a generated mask travels inside the project', async () => {
    // The first thing in a project that is pixels rather than parameters.
    const documentId = await open();
    const segmented = await engine.call('ai.segment', { documentId });
    await apply(documentId, { kind: 'adjust', adjustments: { exposure: 1.5 } });
    const listed = await engine.call('edit.history', { documentId });
    await apply(documentId, {
      kind: 'setLayerMask',
      layerId: listed.result.layers[1].id,
      mask: {
        kind: 'raster',
        raster: segmented.result.raster,
        rasterWidth: segmented.result.width,
        rasterHeight: segmented.result.height,
      },
    });
    const expected = await sample(documentId);
    const subject = expected(0.46, 0.33);
    const background = expected(0.06, 0.12);

    const target = path.join(workDir, 'segmented.myphoto');
    await engine.call('project.save', { documentId, path: target });
    await engine.call('image.close', { documentId });

    const bytes = readFileSync(target);
    assert.ok(bytes.includes(Buffer.from('masks/')), 'no mask entry in the container');

    const opened = await engine.call('project.open', { path: target });
    const mask = opened.result.history.layers[1].mask;
    assert.equal(mask.kind, 'raster');
    assert.equal(mask.raster, segmented.result.raster);

    const actual = await sample(opened.result.id);
    assert.ok(
      Math.abs(actual(0.46, 0.33) - subject) <= 2 &&
        Math.abs(actual(0.06, 0.12) - background) <= 2,
      `the mask did not come back: subject ${subject}->${actual(0.46, 0.33)}, background ${background}->${actual(0.06, 0.12)}`,
    );
    await engine.call('image.close', { documentId: opened.result.id });
  });

  await suite.check('an inference can be cancelled while it runs', async () => {
    const documentId = await open();
    const pending = engine.request('ai.segment', { documentId });
    await engine.call('job.cancel', { jobId: pending.jobId });
    const { header } = await pending;
    // Either it finished before the cancel landed, or it reported back; what
    // must not happen is the request going unanswered.
    assert.ok(
      header.ok === true || header.error.code === 'cancelled',
      `unexpected outcome: ${JSON.stringify(header)}`,
    );
    await engine.call('image.close', { documentId });
  });

  engine.close();
  rmSync(workDir, { recursive: true, force: true });
  return suite.report();
}
