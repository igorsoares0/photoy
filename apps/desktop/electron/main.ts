import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import path from 'node:path';
import { Channels, Events } from '@photoy/ipc';
import { EngineClient } from './engine/engine-client.js';
import { locateEngine } from './engine/locate.js';
import { Database } from './store/database';
import { ThumbnailCache } from './store/thumbnail-cache.js';
import { registerIpcHandlers, type IpcSurface } from './ipc/handlers.js';
import { Recovery, Session } from './ipc/session.js';
import { resolveReadablePath, hasReadableExtension } from './ipc/paths.js';
import { createMainWindow } from './windows/main-window.js';


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
let database: Database | null = null;
let ipc: IpcSurface | null = null;
/** Set once the user has answered the question below, so the second close goes through. */
let closeConfirmed = false;
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

/**
 * Asks before closing a window with edits that are not in a project yet.
 *
 * Without this the application quietly throws the work away: the autosave is a
 * crash net and is cleared on a clean exit, precisely because a clean exit is
 * supposed to mean the user had the chance to decide. This is that chance.
 */
function guardAgainstLosingWork(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (closeConfirmed || !openSession.dirty || openSession.documentId === null) return;
    event.preventDefault();

    void (async () => {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['Salvar', 'Fechar sem salvar', 'Cancelar'],
        defaultId: 0,
        cancelId: 2,
        message: 'Salvar as alterações antes de fechar?',
        detail:
          `As edições de ${openSession.fileName} ainda não estão em um projeto. ` +
          'Fechando sem salvar, elas se perdem.',
      });
      if (response === 2) return;
      if (response === 0) {
        try {
          // A save that was cancelled at the file dialog is not a save, and the
          // window must stay open rather than take the silence for consent.
          if (ipc !== null && !(await ipc.saveCurrent())) return;
        } catch (error) {
          process.stderr.write(`[photoy] save before close failed: ${String(error)}\n`);
          return;
        }
      }
      closeConfirmed = true;
      window.close();
    })();
  });
}

/** Picks up an image passed on the command line, e.g. "Open with Photoy". */
function pathFromArgv(argv: string[]): string | null {
  const candidate = argv.slice(1).find((argument) => hasReadableExtension(argument));
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

    database = new Database(app.getPath('userData'));
    // Pruned once at startup rather than on a timer: the only thing that grows
    // it is browsing, and the only moment it matters is before browsing starts.
    const thumbnails = new ThumbnailCache(app.getPath('userData'));
    thumbnails.prune();
    ipc = registerIpcHandlers(engine, openSession, recovery, database, thumbnails);

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
    guardAgainstLosingWork(mainWindow);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });

    forwardOpenRequest(pathFromArgv(process.argv));

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && engine !== null) {
        mainWindow = createMainWindow(path.join(__dirname, 'preload.cjs'));
        guardAgainstLosingWork(mainWindow);
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
    // Closed rather than left to the process exit, so the write-ahead log is
    // checkpointed into the database instead of being replayed on next start.
    database?.close();
    database = null;
    void engine?.stop();
  });
}
