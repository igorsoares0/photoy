import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// The renderer is loaded from a file:// URL in production, so every asset
// reference has to be relative rather than rooted at /.
export default defineConfig({
  root: path.resolve(__dirname, 'renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    // Bundled from source so the renderer and the main process can never end up
    // compiled against two different versions of the protocol contract.
    alias: {
      '@photoy/ipc': path.resolve(__dirname, '../../packages/ipc/src/index.ts'),
      '@photoy/types': path.resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: { port: 5273, strictPort: true },
});
