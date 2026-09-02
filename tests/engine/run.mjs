import { generateFixtures } from '../fixtures/generate.mjs';
import { run as runPipeline } from './smoke.mjs';
import { run as runColour } from './color.mjs';
import { run as runEdits } from './edits.mjs';
import { run as runAdjustments } from './adjustments.mjs';
import { run as runCurves } from './curves.mjs';
import { run as runThumbnails } from './thumbnails.mjs';
import { run as runBatchExport } from './batch.mjs';
import { run as runJobs } from './jobs.mjs';
import { run as runLayers } from './layers.mjs';
import { run as runProjects } from './project.mjs';
import { run as runMasks } from './masks.mjs';
import { run as runAi } from './ai.mjs';
import { run as runBackground } from './background.mjs';
import { run as runResize } from './resize.mjs';
import { run as runBrush } from './brush.mjs';
import { run as runInpaint } from './inpaint.mjs';
import { run as runRaw } from './raw.mjs';
import { run as runHeic } from './heic.mjs';
import { run as runGeometry } from '../renderer/viewport.mjs';
import { run as runPreviewSizing } from '../renderer/preview.mjs';
import { run as runBrushGeometry } from '../renderer/brush.mjs';
import { run as runDatabase } from '../desktop/database.mjs';
import { run as runPaths } from '../desktop/paths.mjs';
import { run as runLibrary } from '../desktop/library.mjs';
import { run as runEnhance } from '../renderer/enhance.mjs';
import { run as runPortrait } from '../renderer/portrait.mjs';
import { run as runCurveMaths } from '../renderer/curves.mjs';
import { run as runLibraryFilter } from '../renderer/library.mjs';

/**
 * Runs the engine suites against the real binary over the real protocol, plus
 * the renderer's pure geometry.
 *
 * Fixtures are written first so a checkout with no generated images still runs,
 * and the suites share one process so a failure in either sets the exit code.
 */
generateFixtures();

let failures = 0;
for (const suite of [runPipeline, runColour, runEdits, runAdjustments, runCurves, runThumbnails, runBatchExport, runLayers, runMasks, runAi, runBackground, runResize, runBrush, runInpaint, runRaw, runHeic, runProjects, runJobs, runGeometry, runPreviewSizing, runBrushGeometry, runDatabase, runPaths, runLibrary, runEnhance, runPortrait, runCurveMaths, runLibraryFilter]) {
  failures += await suite();
}

console.log(
  failures === 0 ? '\nall engine tests passed' : `\n${failures} test(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
