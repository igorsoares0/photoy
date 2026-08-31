import { generateFixtures } from '../fixtures/generate.mjs';
import { run as runPipeline } from './smoke.mjs';
import { run as runColour } from './color.mjs';
import { run as runEdits } from './edits.mjs';
import { run as runAdjustments } from './adjustments.mjs';
import { run as runJobs } from './jobs.mjs';
import { run as runLayers } from './layers.mjs';
import { run as runProjects } from './project.mjs';
import { run as runMasks } from './masks.mjs';
import { run as runGeometry } from '../renderer/viewport.mjs';

/**
 * Runs the engine suites against the real binary over the real protocol, plus
 * the renderer's pure geometry.
 *
 * Fixtures are written first so a checkout with no generated images still runs,
 * and the suites share one process so a failure in either sets the exit code.
 */
generateFixtures();

let failures = 0;
for (const suite of [runPipeline, runColour, runEdits, runAdjustments, runLayers, runMasks, runProjects, runJobs, runGeometry]) {
  failures += await suite();
}

console.log(
  failures === 0 ? '\nall engine tests passed' : `\n${failures} test(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
