import type {
  DocumentInfo,
  EditHistory,
  ExportRequest,
  ExportResult,
  Operation,
  Preview,
  PreviewRequest,
} from '@photoy/types';
import type { EngineDescription } from './methods.js';

export type EngineState = 'starting' | 'ready' | 'stopped' | 'failed';

export interface SessionBootstrap {
  engineState: EngineState;
  /** A file the app was launched with, or null. */
  pendingOpenPath: string | null;
}

/**
 * Every call resolves to a discriminated result rather than throwing across
 * the bridge, so the renderer always has an error object it can render with a
 * cause and a technical note.
 */
export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; detail?: string } };

/** Shape of `window.photoy`, installed by the preload script. */
export interface PhotoyApi {
  describeEngine(): Promise<ApiResult<EngineDescription>>;

  /** Opens the native file picker, then decodes the chosen image. */
  openImageDialog(): Promise<ApiResult<DocumentInfo | null>>;
  /** Opens a path the main process already vetted, e.g. from drag and drop. */
  openImagePath(path: string): Promise<ApiResult<DocumentInfo>>;
  closeImage(documentId: string): Promise<ApiResult<{ closed: boolean }>>;

  /**
   * Renders the edit stack at the requested size. Successive calls supersede
   * one another, so a render made obsolete by the next one resolves to a
   * `cancelled` error rather than wasting the machine finishing it.
   */
  renderPreview(request: PreviewRequest): Promise<ApiResult<Preview>>;

  /**
   * Records an operation.
   *
   * `replaceTop` overwrites an operation of the same kind already on top, which
   * is what collapses a dragged slider into one undo step instead of forty.
   */
  applyEdit(
    documentId: string,
    operation: Operation,
    replaceTop?: boolean,
  ): Promise<ApiResult<EditHistory>>;
  undoEdit(documentId: string): Promise<ApiResult<EditHistory>>;
  redoEdit(documentId: string): Promise<ApiResult<EditHistory>>;
  resetEdits(documentId: string): Promise<ApiResult<EditHistory>>;

  /** Opens the native save dialog and returns the chosen destination. */
  chooseExportPath(suggestedName: string): Promise<ApiResult<string | null>>;
  exportImage(request: ExportRequest): Promise<ApiResult<ExportResult>>;

  /**
   * Resolves the filesystem path of a dropped File. Electron removed File.path
   * from the renderer, so this has to go through webUtils in the preload.
   * Returns null when the drop carried no real file.
   */
  pathForFile(file: File): string | null;

  /**
   * Everything that happened before the renderer existed.
   *
   * Both the engine's readiness and a file passed on the command line are
   * settled during startup, so pushing them as events races the renderer's own
   * mount. It pulls them once instead. The pending path is cleared by the read,
   * so a reload does not reopen the same file.
   */
  bootstrap(): Promise<ApiResult<SessionBootstrap>>;

  onEngineStateChanged(listener: (state: EngineState) => void): () => void;
  onOpenRequested(listener: (path: string) => void): () => void;
}
