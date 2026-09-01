import type {
  FaceDetection,
  ImageAnalysis,
  Preset,
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

/** A document plus the stack it was opened with. */
export interface OpenedProject {
  document: DocumentInfo;
  history: EditHistory;
  path: string | null;
}

export interface SessionBootstrap {
  engineState: EngineState;
  /** A file the app was launched with, or null. */
  pendingOpenPath: string | null;
  /**
   * A session the last run did not finish, if there is one. The user decides
   * whether to take it; nothing is restored behind their back.
   */
  recovery: RecoveryOffer | null;
}

export interface RecoveryOffer {
  /** Name of the photograph the unfinished session was working on. */
  fileName: string;
  /** When it was last written, in milliseconds since the epoch. */
  savedAt: number;
}

/** What is open, and whether it has changes the project file does not have. */
/** A backdrop image, placed to cover the frame. */
export interface BackdropResult {
  documentId: string;
  patch: number;
  patchWidth: number;
  patchHeight: number;
}

/** A stored mask handed back with its pixels. */
export interface StoredMask {
  raster: number;
  width: number;
  height: number;
  coverage: Uint8Array;
}

export interface SegmentResult {
  documentId: string;
  raster: number;
  width: number;
  height: number;
}

/** Where a model filled something in, and the pixels it kept to do it. */
export interface InpaintResult {
  documentId: string;
  patch: number;
  /** The window, in natural document coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The natural document size the window was measured against. */
  documentWidth: number;
  documentHeight: number;
}

export interface ProjectState {
  /** Path of the .myphoto this document is saved as, or null if never saved. */
  path: string | null;
  /** True when there are edits the saved project does not contain. */
  dirty: boolean;
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
  /**
   * Runs segmentation over the document and returns the mask it produced.
   *
   * The mask is stored in the engine; what comes back is the identifier and the
   * document size it was made for.
   */
  segment(documentId: string): Promise<ApiResult<SegmentResult>>;

  /**
   * Finds the faces in the document as it currently stands.
   *
   * Reports positions and nothing else: no mask, because eight portrait tools
   * want eight different regions out of the same five points, and deciding
   * which belongs to the interface.
   */
  detectFaces(documentId: string): Promise<ApiResult<FaceDetection>>;

  /**
   * Hands a painted mask to the engine and gets back its identifier.
   *
   * One byte of coverage per pixel, rows top to bottom, no padding - the same
   * shape a segmented mask has, because the brush and the model are producing
   * the same kind of thing and nothing downstream should be able to tell them
   * apart.
   */
  storeMask(
    documentId: string,
    width: number,
    height: number,
    coverage: Uint8Array,
  ): Promise<ApiResult<SegmentResult>>;

  /** Reads a stored mask back, so a brush can carry on from what is there. */
  fetchMask(documentId: string, raster: number): Promise<ApiResult<StoredMask>>;

  /**
   * Fills what a mask marks, using what surrounds it.
   *
   * The pixels are kept in the engine; what comes back is the identifier and
   * the window they cover.
   */
  inpaint(documentId: string, raster: number): Promise<ApiResult<InpaintResult>>;

  /**
   * The user's own presets. The ones shipped with the app are a constant in
   * `@photoy/types`, not rows: they travel with the version that defines them
   * and cannot be lost or corrupted.
   */
  listPresets(): Promise<ApiResult<Preset[]>>;
  savePreset(preset: Omit<Preset, 'builtIn'>): Promise<ApiResult<Preset[]>>;
  deletePreset(id: string): Promise<ApiResult<Preset[]>>;

  /**
   * Measures the document as it currently looks.
   *
   * Only measures. What a measurement is worth is decided in the renderer,
   * where it can be argued with.
   */
  analyse(documentId: string): Promise<ApiResult<ImageAnalysis>>;

  /** Opens a project by path, for the recent list. */
  openProjectPath(path: string): Promise<ApiResult<OpenedProject>>;

  /**
   * Files opened before, newest first, with the ones that vanished dropped.
   *
   * A photograph is replaced by the project saved from it: once the work
   * exists, offering the untouched picture is offering to start again.
   */
  listRecent(): Promise<ApiResult<string[]>>;

  /**
   * Asks for an image and keeps it as a backdrop for a matte layer.
   *
   * Null when the dialog was dismissed. The picture is cropped to the shape of
   * the document and scaled to fill it, so it covers the frame without being
   * stretched.
   */
  chooseBackground(documentId: string): Promise<ApiResult<BackdropResult | null>>;

  applyEdit(
    documentId: string,
    operation: Operation,
    replaceTop?: boolean,
  ): Promise<ApiResult<EditHistory>>;
  undoEdit(documentId: string): Promise<ApiResult<EditHistory>>;
  redoEdit(documentId: string): Promise<ApiResult<EditHistory>>;
  /** Jumps to a point in the history. Undo and redo are this with a step of one. */
  seekEdit(documentId: string, cursor: number): Promise<ApiResult<EditHistory>>;
  resetEdits(documentId: string): Promise<ApiResult<EditHistory>>;
  /** Reads the stack without changing it, so a freshly opened document is known. */
  readHistory(documentId: string): Promise<ApiResult<EditHistory>>;

  /** Opens the picker, then a .myphoto. Resolves to null when cancelled. */
  openProject(): Promise<ApiResult<OpenedProject | null>>;
  /** Saves to the current path, asking for one the first time. */
  saveProject(): Promise<ApiResult<ProjectState | null>>;
  /** Always asks for a path. */
  saveProjectAs(): Promise<ApiResult<ProjectState | null>>;

  /** Opens the unfinished session the last run left behind. */
  takeRecovery(): Promise<ApiResult<OpenedProject | null>>;
  /** Throws it away, so it stops being offered. */
  discardRecovery(): Promise<ApiResult<void>>;

  onProjectChanged(listener: (state: ProjectState) => void): () => void;

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
