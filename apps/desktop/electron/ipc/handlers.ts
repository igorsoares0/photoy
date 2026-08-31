import { BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import {
  Channels,
  Events,
  type ApiResult,
  type OpenedProject,
  type ProjectState,
  type BackdropResult,
  type InpaintResult,
  type SegmentResult,
} from '@photoy/ipc';
import { Database } from '../store/database';
import type {
  DocumentInfo,
  EditHistory,
  ExportResult,
  Operation,
  Preset,
  PreviewInfo,
  PreviewRequest,
} from '@photoy/types';
import { existsSync } from 'node:fs';
import { EngineCallError, type EngineClient } from '../engine/engine-client.js';
import { PathRejected, resolveReadablePath, resolveWritablePath } from './paths.js';
import type { Recovery, Session } from './session.js';

const PROJECT_FILTERS = [{ name: 'Projeto Photoy', extensions: ['myphoto'] }];

const IMAGE_FILTERS = [
  { name: 'Imagens', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'] },
  { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { name: 'PNG', extensions: ['png'] },
  { name: 'TIFF', extensions: ['tif', 'tiff'] },
  { name: 'WebP', extensions: ['webp'] },
];

/**
 * Wraps a handler so every channel answers with a discriminated result.
 *
 * Throwing across the bridge would reach the renderer as an opaque
 * "Error invoking remote method"; the UI needs a code and a technical note to
 * write an error the user can act on.
 */
function handle<T>(channel: string, run: (...args: never[]) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<ApiResult<T>> => {
    try {
      return { ok: true, value: await run(...(args as never[])) };
    } catch (error) {
      if (error instanceof EngineCallError) {
        return { ok: false, error: { code: error.code, message: error.message, detail: error.detail } };
      }
      if (error instanceof PathRejected) {
        return { ok: false, error: { code: error.code, message: error.message, detail: error.detail } };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: 'internal_error', message: 'Unexpected failure', detail: message } };
    }
  });
}

export function registerIpcHandlers(
  engine: EngineClient,
  session: Session,
  recovery: Recovery,
  database: Database,
): void {
  const announce = () => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.webContents.send(Events.projectChanged, session.state());
  };

  /** Every edit is a change the saved project does not have yet. */
  const markDirty = () => {
    if (session.dirty) return;
    session.dirty = true;
    announce();
  };

  const openProjectAt = async (projectPath: string): Promise<OpenedProject> => {
    const { result } = await engine.call<DocumentInfo & { history: EditHistory; projectPath: string }>(
      'project.open',
      { path: projectPath },
    );
    const { history, ...document } = result;
    session.open(document.id, document.image.fileName, projectPath);
    announce();
    return { document, history, path: projectPath };
  };

  const saveTo = async (projectPath: string): Promise<ProjectState> => {
    if (session.documentId === null) throw new PathRejected('Nothing to save', 'no document');
    await engine.call('project.save', { documentId: session.documentId, path: projectPath });
    session.path = projectPath;
    session.dirty = false;
    // The unfinished session is only meaningful until the work is somewhere
    // safe; keeping it would offer to restore something already saved.
    recovery.clear();
    announce();
    return session.state();
  };

  handle(Channels.engineDescribe, async () => {
    const { result } = await engine.call('engine.describe');
    return result;
  });

  handle(Channels.imageOpenDialog, async (): Promise<DocumentInfo | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = window
      ? await dialog.showOpenDialog(window, {
          title: 'Abrir imagem',
          properties: ['openFile'],
          filters: IMAGE_FILTERS,
        })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters: IMAGE_FILTERS });

    if (picked.canceled || picked.filePaths.length === 0) return null;
    const filePath = resolveReadablePath(picked.filePaths[0]);
    const { result } = await engine.call<DocumentInfo>('image.open', { path: filePath });
    // A photograph opened directly is not yet a project: it has no path to save
    // back to, and the first save has to ask for one.
    session.open(result.id, result.image.fileName, null);
    database.rememberFile(filePath);
    announce();
    return result;
  });

  handle(Channels.imageOpenPath, async (candidate: string): Promise<DocumentInfo> => {
    const filePath = resolveReadablePath(candidate);
    const { result } = await engine.call<DocumentInfo>('image.open', { path: filePath });
    session.open(result.id, result.image.fileName, null);
    database.rememberFile(filePath);
    announce();
    return result;
  });

  handle(Channels.imageClose, async (documentId: string) => {
    const { result } = await engine.call<{ closed: boolean }>('image.close', { documentId });
    if (session.documentId === documentId) {
      session.close();
      announce();
    }
    return result;
  });

  handle(Channels.imageRenderPreview, async (request: PreviewRequest) => {
    // One key per document, so a burst of viewport changes collapses to the
    // last render instead of queueing every intermediate one.
    const { result, payload } = await engine.call<PreviewInfo>(
      'image.renderPreview',
      request,
      // The comparison view has a key of its own: it must not cancel the live
      // preview, nor be cancelled by it, because the two are shown together.
      `preview:${request.baseline === true ? 'baseline:' : ''}${request.documentId}`,
    );
    // The Buffer is transferred to the renderer as its own ArrayBuffer; slicing
    // the underlying pool would otherwise leak unrelated bytes across the bridge.
    const pixels = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    ) as ArrayBuffer;
    return { ...result, pixels };
  });

  handle(Channels.imageExportDialog, async (suggestedName: string): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Exportar imagem',
      defaultPath: suggestedName,
      filters: IMAGE_FILTERS.slice(1),
    };
    const picked = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);

    if (picked.canceled || !picked.filePath) return null;
    return resolveWritablePath(picked.filePath);
  });

  handle(Channels.imageExport, async (request: {
    documentId: string;
    path: string;
    format: string;
    quality?: number;
    colorSpace?: string;
    sixteenBit?: boolean;
    preserveMetadata?: boolean;
  }): Promise<ExportResult> => {
    const targetPath = resolveWritablePath(request.path);
    const { result } = await engine.call<ExportResult>('image.export', {
      ...request,
      path: targetPath,
    });
    return result;
  });

  const editCall = (method: string, dirties: boolean) =>
    async (documentId: string): Promise<EditHistory> => {
      const { result } = await engine.call<EditHistory>(method, { documentId });
      if (dirties) markDirty();
      return result;
    };

  handle(Channels.editApply, async (documentId: string, operation: Operation, replaceTop: boolean) => {
    const { result } = await engine.call<EditHistory>('edit.apply', {
      documentId,
      operation,
      replaceTop,
    });
    markDirty();
    return result;
  });
  handle(Channels.editUndo, editCall('edit.undo', true));
  handle(Channels.editRedo, editCall('edit.redo', true));
  handle(Channels.editSeek, async (documentId: string, cursor: number) => {
    const { result } = await engine.call<EditHistory>('edit.seek', { documentId, cursor });
    markDirty();
    return result;
  });
  handle(Channels.editReset, editCall('edit.reset', true));
  // Reading the stack changes nothing, so it must not mark the session dirty.
  handle(Channels.editHistory, editCall('edit.history', false));

  handle(Channels.projectOpen, async (): Promise<OpenedProject | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { title: 'Abrir projeto', properties: ['openFile' as const], filters: PROJECT_FILTERS };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return openProjectAt(path.resolve(picked.filePaths[0] as string));
  });

  const chooseProjectPath = async (): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const base = session.fileName.replace(/\.[^.]+$/, '') || 'projeto';
    const options = {
      title: 'Salvar projeto',
      defaultPath: `${base}.myphoto`,
      filters: PROJECT_FILTERS,
    };
    const picked = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    return picked.canceled || !picked.filePath ? null : path.resolve(picked.filePath);
  };

  handle(Channels.projectSave, async (): Promise<ProjectState | null> => {
    const target = session.path ?? (await chooseProjectPath());
    return target === null ? null : saveTo(target);
  });

  handle(Channels.projectSaveAs, async (): Promise<ProjectState | null> => {
    const target = await chooseProjectPath();
    return target === null ? null : saveTo(target);
  });

  handle(Channels.projectState, async () => session.state());

  handle(Channels.recoveryTake, async (): Promise<OpenedProject | null> => {
    if (recovery.offer() === null) return null;
    const opened = await openProjectAt(recovery.projectPath);
    // The restored session has no home of its own: the first save must ask.
    session.path = null;
    session.dirty = true;
    recovery.clear();
    announce();
    return { ...opened, path: null };
  });

  handle(Channels.recoveryDiscard, async () => {
    recovery.clear();
  });

  handle(Channels.aiSegment, async (documentId: string) => {
    const { result } = await engine.call<SegmentResult>('ai.segment', { documentId });
    return result;
  });

  handle(
    Channels.maskStore,
    async (documentId: string, width: number, height: number, coverage: Uint8Array) => {
      const { result } = await engine.call<SegmentResult>(
        'mask.store',
        { documentId, width, height },
        undefined,
        Buffer.from(coverage.buffer, coverage.byteOffset, coverage.byteLength),
      );
      return result;
    },
  );

  handle(Channels.maskFetch, async (documentId: string, raster: number) => {
    const { result, payload } = await engine.call<SegmentResult>('mask.fetch', {
      documentId,
      raster,
    });
    // Copied out of the pipe buffer: the array crosses to the renderer and must
    // not be a view onto memory the reader is about to reuse.
    return { ...result, coverage: new Uint8Array(payload) };
  });

  handle(Channels.aiInpaint, async (documentId: string, raster: number) => {
    const { result } = await engine.call<InpaintResult>('ai.inpaint', { documentId, raster });
    return result;
  });

  // Paths are checked as they go out rather than as they come in: a file can
  // be moved or deleted between one run and the next, and offering to open
  // something that is no longer there is worse than not offering it.
  handle(Channels.recentList, async () => {
    const remembered = database.recentFiles();
    const alive: string[] = [];
    for (const candidate of remembered) {
      if (existsSync(candidate)) alive.push(candidate);
      else database.forgetFile(candidate);
    }
    return alive;
  });

  handle(Channels.backgroundChoose, async (documentId: string) => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Escolher fundo',
      properties: ['openFile' as const],
      filters: IMAGE_FILTERS,
    };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;

    const filePath = resolveReadablePath(picked.filePaths[0]);
    const { result } = await engine.call<BackdropResult>('background.load', {
      documentId,
      path: filePath,
    });
    return result;
  });

  handle(Channels.presetList, async () => database.listPresets());

  handle(Channels.presetSave, async (preset: Omit<Preset, 'builtIn'>) => {
    database.savePreset(preset);
    return database.listPresets();
  });

  handle(Channels.presetDelete, async (id: string) => {
    database.deletePreset(id);
    return database.listPresets();
  });
}

/** Suggests an export name derived from the source file. */
export function suggestExportName(sourcePath: string, extension: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return `${base}-export.${extension}`;
}
