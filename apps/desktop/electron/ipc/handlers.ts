import { BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { Channels, type ApiResult } from '@photoy/ipc';
import type { DocumentInfo, EditHistory, ExportResult, Operation, PreviewInfo } from '@photoy/types';
import { EngineCallError, type EngineClient } from '../engine/engine-client.js';
import { PathRejected, resolveReadablePath, resolveWritablePath } from './paths.js';

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

export function registerIpcHandlers(engine: EngineClient): void {
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
    return result;
  });

  handle(Channels.imageOpenPath, async (candidate: string): Promise<DocumentInfo> => {
    const filePath = resolveReadablePath(candidate);
    const { result } = await engine.call<DocumentInfo>('image.open', { path: filePath });
    return result;
  });

  handle(Channels.imageClose, async (documentId: string) => {
    const { result } = await engine.call<{ closed: boolean }>('image.close', { documentId });
    return result;
  });

  handle(Channels.imageRenderPreview, async (request: { documentId: string; maxWidth: number; maxHeight: number }) => {
    // One key per document, so a burst of viewport changes collapses to the
    // last render instead of queueing every intermediate one.
    const { result, payload } = await engine.call<PreviewInfo>(
      'image.renderPreview',
      request,
      `preview:${request.documentId}`,
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

  const editCall = (method: string) => async (documentId: string): Promise<EditHistory> => {
    const { result } = await engine.call<EditHistory>(method, { documentId });
    return result;
  };

  handle(Channels.editApply, async (documentId: string, operation: Operation, replaceTop: boolean) => {
    const { result } = await engine.call<EditHistory>('edit.apply', {
      documentId,
      operation,
      replaceTop,
    });
    return result;
  });
  handle(Channels.editUndo, editCall('edit.undo'));
  handle(Channels.editRedo, editCall('edit.redo'));
  handle(Channels.editReset, editCall('edit.reset'));
  handle(Channels.editHistory, editCall('edit.history'));

  handle(Channels.recentList, async () => [] as string[]);
}

/** Suggests an export name derived from the source file. */
export function suggestExportName(sourcePath: string, extension: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return `${base}-export.${extension}`;
}
