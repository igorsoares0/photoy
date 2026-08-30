import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineClient } from './client.mjs';
import { createSuite } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const enginePath = path.join(root, 'apps', 'desktop', 'resources', 'engine', 'photoy-engine.exe');
const fixtures = path.join(root, 'tests', 'fixtures');

const MEGABYTE = 1024 * 1024;

export async function run() {
  assert.ok(existsSync(enginePath), `engine not built at ${enginePath}`);
  const suite = createSuite('job queue');

  await suite.check('describe reports the queue budget', async () => {
    const engine = new EngineClient(enginePath);
    const { result } = await engine.call('engine.describe');
    assert.ok(result.jobs.workers >= 1, 'no workers');
    assert.ok(
      result.jobs.budgetBytes >= 256 * MEGABYTE,
      `budget looks wrong: ${result.jobs.budgetBytes}`,
    );
    assert.equal(result.jobs.admittedBytes, 0, 'nothing should be admitted while idle');
    engine.close();
  });

  await suite.check('the budget is honoured, and taken from the environment', async () => {
    const engine = new EngineClient(enginePath, { PHOTOY_JOB_MEMORY_BUDGET_MB: '1' });
    const { result } = await engine.call('engine.describe');
    assert.equal(result.jobs.budgetBytes, MEGABYTE, 'the override was ignored');
    engine.close();
  });

  await suite.check('a budget too small for two jobs runs them one at a time', async () => {
    // One megabyte is under the cost of any real render, so nothing may pair up.
    const engine = new EngineClient(enginePath, { PHOTOY_JOB_MEMORY_BUDGET_MB: '1' });
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'large.png') });
    const documentId = opened.result.id;

    // Distinct keys, so these compete for the budget rather than superseding
    // one another.
    const settled = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        engine.request(
          'image.renderPreview',
          { documentId, maxWidth: 900 + i, maxHeight: 700 },
          `slot-${i}`,
        ),
      ),
    );
    for (const { header } of settled) {
      assert.equal(header.ok, true, `a render failed: ${JSON.stringify(header.error)}`);
    }

    const { result } = await engine.call('engine.describe');
    assert.equal(
      result.jobs.peakConcurrentJobs,
      1,
      `expected serialised execution, saw ${result.jobs.peakConcurrentJobs} at once`,
    );
    engine.close();
  });

  await suite.check('a job larger than the whole budget still runs', async () => {
    // The rule that admits a job when nothing else is running is what keeps an
    // oversized one from waiting forever for room that will never appear.
    const engine = new EngineClient(enginePath, { PHOTOY_JOB_MEMORY_BUDGET_MB: '1' });
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'large.png') });
    const { result } = await engine.call('image.renderPreview', {
      documentId: opened.result.id,
      maxWidth: 2600,
      maxHeight: 1800,
    });
    assert.equal(result.width, 2600);
    engine.close();
  });

  await suite.check('an ample budget lets small renders overlap', async () => {
    const engine = new EngineClient(enginePath, { PHOTOY_JOB_MEMORY_BUDGET_MB: '4096' });
    const opened = await engine.call('image.open', { path: path.join(fixtures, 'large.png') });
    const documentId = opened.result.id;

    const settled = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        engine.request('image.renderPreview', { documentId, maxWidth: 900 + i, maxHeight: 700 }, `slot-${i}`),
      ),
    );
    for (const { header } of settled) assert.equal(header.ok, true);

    const { result } = await engine.call('engine.describe');
    assert.ok(result.jobs.peakAdmittedBytes > 0, 'nothing was ever charged to the budget');
    assert.ok(
      result.jobs.peakAdmittedBytes <= result.jobs.budgetBytes,
      'admitted more than the budget allowed',
    );
    assert.equal(result.jobs.admittedBytes, 0, 'the budget was not released');
    engine.close();
  });

  return suite.report();
}
