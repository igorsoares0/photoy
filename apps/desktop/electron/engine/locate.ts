import { app } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';

const EXECUTABLE_NAME = process.platform === 'win32' ? 'photoy-engine.exe' : 'photoy-engine';

/**
 * Finds the native engine binary.
 *
 * Packaged builds carry it under the app's resources directory; during
 * development it comes straight out of the CMake build, published there by
 * scripts/build-native.bat.
 */
export function locateEngine(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'engine', EXECUTABLE_NAME)]
    : [
        path.join(app.getAppPath(), 'resources', 'engine', EXECUTABLE_NAME),
        path.join(app.getAppPath(), '..', '..', 'build', 'Release', 'bin', EXECUTABLE_NAME),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    `Native engine not found. Looked in:\n${candidates.join('\n')}\nRun: npm run build:native`,
  );
}
