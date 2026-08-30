import esbuild from 'esbuild';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

import { electronBuildOptions } from './build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Development runner: Vite serves the renderer with hot reload, esbuild watches
 * the Electron side, and Electron itself is restarted whenever main or preload
 * change - there is no way to hot-swap those in place.
 */
const server = await createServer({ configFile: path.join(here, 'vite.config.ts') });
await server.listen();
const address = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5273/';
console.log(`[photoy] renderer on ${address}`);

let child = null;

function startElectron() {
  child = spawn(electron, [here], {
    stdio: 'inherit',
    env: { ...process.env, PHOTOY_DEV_SERVER: address.replace(/\/$/, '') },
  });
  child.on('exit', (code) => {
    if (code !== null && restarting === false) {
      void server.close().then(() => process.exit(code ?? 0));
    }
  });
}

let restarting = false;

const context = await esbuild.context({
  ...electronBuildOptions('development'),
  plugins: [
    {
      name: 'restart-electron',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length > 0) return;
          if (child === null) {
            startElectron();
            return;
          }
          restarting = true;
          child.once('exit', () => {
            restarting = false;
            startElectron();
          });
          child.kill();
        });
      },
    },
  ],
});

await context.watch();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child?.kill();
    void context.dispose();
    void server.close().then(() => process.exit(0));
  });
}
