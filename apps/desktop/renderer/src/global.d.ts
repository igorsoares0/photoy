import type { PhotoyApi } from '@photoy/ipc';

declare global {
  interface Window {
    /** Installed by the preload script; the renderer's only way out. */
    readonly photoy: PhotoyApi;
  }
}

export {};
