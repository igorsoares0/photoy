import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { Channels, Events } from '@photoy/ipc';
import { EngineClient } from './engine/engine-client.js';
import { locateEngine } from './engine/locate.js';
import { registerIpcHandlers } from './ipc/handlers.js';
import { Recovery, Session } from './ipc/session.js';
import { resolveReadablePath } from './ipc/paths.js';
import { createMainWindow } from './windows/main-window.js';

const READABLE_EXTENSIONS = /\.(jpe?g|png|tiff?|webp)$/i;

let engine: EngineClient | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * A path handed to the app before the renderer was listening.
 *
 * Pushing it on did-finish-load raced the renderer's own effect setup, so the
 * path is parked here and the renderer claims it once it is ready.
 */
let pendingOpenPath: string | null = null;

const openSession = new Session();
let recovery: Recovery | null = null;
let autosaveTimer: NodeJS.Timeout | null = null;

/**
 * How often the unfinished session is written.
 *
 * Long enough that it costs nothing while working, short enough that a crash
 * loses a gesture rather than an afternoon. Overridable so the recovery path
 * can be exercised without waiting half a minute for it.
 */
function autosaveIntervalMs(): number {
  const seconds = Number(process.env['PHOTOY_AUTOSAVE_SECONDS']);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 30_000;
}

/**
 * Writes the open document to the recovery slot.
 *
 * Never to the user's own project: an autosave that overwrote the file being
 * edited would turn a crash into data loss instead of preventing one.
 */
async function autosave(engine: EngineClient): Promise<void> {
  if (recovery === null || openSession.documentId === null || !openSession.dirty) return;
  try {
    recovery.prepare();
    await engine.call('project.save', {
      documentId: openSession.documentId,
      path: recovery.projectPath,
    });
    recovery.mark(openSession.fileName, openSession.path);
  } catch (error) {
    // A failed autosave must not disturb the session it is protecting.
    process.stderr.write(`[photoy] autosave failed: ${String(error)}\n`);
  }
}

/** Picks up an image passed on the command line, e.g. "Open with Photoy". */
function pathFromArgv(argv: string[]): string | null {
  const candidate = argv.slice(1).find((argument) => READABLE_EXTENSIONS.test(argument));
  if (candidate === undefined) return null;
  try {
    return resolveReadablePath(candidate);
  } catch {
    return null;
  }
}

function forwardOpenRequest(filePath: string | null): void {
  if (filePath === null) return;
  pendingOpenPath = filePath;
  if (mainWindow !== null && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send(Events.openRequested, filePath);
  }
}

// A second launch should reuse the running window rather than start a rival
// engine process holding its own copy of every open document.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    forwardOpenRequest(pathFromArgv(argv));
  });

  void app.whenReady().then(() => {
    // The renderer only ever loads its own bundle, so nothing needs to reach
    // the network; denying it outright removes a whole class of exfiltration.
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        const isDevServer =
          process.env['PHOTOY_DEV_SERVER'] !== undefined &&
          details.url.startsWith(process.env['PHOTOY_DEV_SERVER']);
        callback({ cancel: !isDevServer });
      },
    );

    engine = new EngineClient(locateEngine());
    engine.on('state', (state: string) => {
      mainWindow?.webContents.send(Events.engineStateChanged, state);
    });
    engine.start();

    recovery = new Recovery();
    // Read before anything can overwrite it: the offer describes the previous
    // run, and this run's first autosave would replace it.
    const offer = recovery.offer();

    registerIpcHandlers(engine, openSession, recovery);

    const worker = engine;
    autosaveTimer = setInterval(() => void autosave(worker), autosaveIntervalMs());

    ipcMain.handle(Channels.sessionBootstrap, () => {
      const pendingPath = pendingOpenPath;
      pendingOpenPath = null;
      return {
        ok: true,
        value: {
          engineState: engine?.state ?? 'stopped',
          pendingOpenPath: pendingPath,
          recovery: offer,
        },
      };
    });

    mainWindow = createMainWindow(path.join(__dirname, 'preload.cjs'));
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    forwardOpenRequest(pathFromArgv(process.argv));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && engine !== null) {
        mainWindow = createMainWindow(path.join(__dirname, 'preload.cjs'));
      }
    });
  });

  // macOS delivers "open with" through this event rather than argv.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    try {
      forwardOpenRequest(resolveReadablePath(filePath));
    } catch {
      // An unopenable path is not worth interrupting startup over.
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (autosaveTimer !== null) clearTimeout(autosaveTimer);
    // A clean exit means there is nothing to recover from. Anything unsaved was
    // the user's choice to leave unsaved, and offering it back next time would
    // be the application second-guessing them.
    recovery?.clear();
    void engine?.stop();
  });
}
