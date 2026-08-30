import esbuild from 'esbuild';
import { build as viteBuild } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/**
 * The shared packages are bundled from TypeScript source rather than from a
 * built dist, so a change to the protocol contract cannot be picked up by one
 * side and missed by the other.
 */
export const workspaceAlias = {
  '@photoy/ipc': path.join(root, 'packages/ipc/src/index.ts'),
  '@photoy/types': path.join(root, 'packages/types/src/index.ts'),
};

/** Electron's main and preload scripts. CommonJS: a sandboxed preload requires it. */
export function electronBuildOptions(mode) {
  return {
    entryPoints: {
      main: path.join(here, 'electron/main.ts'),
      preload: path.join(here, 'electron/preload.ts'),
    },
    outdir: path.join(here, 'dist/electron'),
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: true,
    minify: mode === 'production',
    external: ['electron'],
    alias: workspaceAlias,
    logLevel: 'info',
  };
}

export async function buildAll(mode = 'production') {
  await esbuild.build(electronBuildOptions(mode));
  await viteBuild({ configFile: path.join(here, 'vite.config.ts'), mode });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('build.mjs')) {
  await buildAll(process.env.NODE_ENV === 'development' ? 'development' : 'production');
}
