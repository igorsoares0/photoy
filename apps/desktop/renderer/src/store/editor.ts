import { create } from 'zustand';
import type {
  AdjustmentKey,
  Adjustments,
  DocumentInfo,
  EditHistory,
  ExportRequest,
  ExportResult,
  ImageFormat,
  Operation,
  OutputSpace,
} from '@photoy/types';
import { NEUTRAL_ADJUSTMENTS } from '@photoy/types';
import type { ApiResult, EngineState } from '@photoy/ipc';
import { toBitmap } from '../lib/preview';

export interface EditorError {
  code: string;
  message: string;
  detail?: string;
}

export interface PreviewState {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** Preview width divided by document width. */
  scale: number;
}

export type Busy = 'opening' | 'rendering' | 'exporting' | null;

/** What the export dialog collects before a destination is chosen. */
export interface ExportOptions {
  format: ImageFormat;
  quality: number;
  colorSpace: OutputSpace;
  sixteenBit: boolean;
  preserveMetadata: boolean;
}

export interface Viewport {
  /** Displayed size divided by document size. 1 means one image pixel per CSS pixel. */
  scale: number;
  /** Pan offset in CSS pixels, from the centre of the viewport. */
  offsetX: number;
  offsetY: number;
  /** Scale at which the whole image fits the viewport, kept for the fit action. */
  fitScale: number;
}

interface EditorState {
  engineState: EngineState;
  document: DocumentInfo | null;
  /** The edit stack as the engine reports it. Null until a document is open. */
  history: EditHistory | null;
  /** What the sliders show while the engine catches up with a drag. */
  pendingAdjustments: Adjustments | null;
  preview: PreviewState | null;
  viewport: Viewport;
  busy: Busy;
  error: EditorError | null;
  lastExport: ExportResult | null;
  /**
   * Bumped on every stack change, so the canvas re-renders. A counter rather
   * than a flag: two edits in a row each need their own pass.
   */
  fitRequest: number;
  /** Whether the pending pass should also refit the zoom. */
  fitOnRequest: boolean;

  setEngineState(state: EngineState): void;
  openDialog(): Promise<void>;
  openPath(path: string): Promise<void>;
  closeDocument(): Promise<void>;
  requestPreview(targetWidth: number, targetHeight: number): Promise<void>;

  applyEdit(operation: Operation): Promise<void>;
  /**
   * Moves one slider. `continuing` is true for every frame of a drag after the
   * first, which is what makes the gesture a single undo step.
   */
  setAdjustment(key: AdjustmentKey, value: number, continuing: boolean): Promise<void>;
  resetAdjustments(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  resetEdits(): Promise<void>;
  exportImage(options: ExportOptions): Promise<void>;

  setViewport(next: Partial<Viewport>): void;
  fitToViewport(viewportWidth: number, viewportHeight: number): void;
  zoomAt(factor: number, anchorX: number, anchorY: number): void;
  panBy(deltaX: number, deltaY: number): void;

  dismissError(): void;
  dismissExport(): void;
}

const MIN_SCALE = 0.02;
const MAX_SCALE = 32;

const INITIAL_VIEWPORT: Viewport = { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 };

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Identifies the newest preview request, so older ones can bow out. */
let previewToken = 0;

type SetState = (partial: Partial<EditorState>) => void;
type GetState = () => EditorState;

/**
 * Applies an engine history response to the store.
 *
 * A rotation or crop changes the rendered size, which invalidates both the
 * preview on screen and the zoom that was fitted to the old one - so the canvas
 * is asked to refit rather than left showing a stale frame at the wrong scale.
 */
async function adoptHistory(
  set: SetState,
  get: GetState,
  response: ApiResult<EditHistory>,
): Promise<void> {
  if (!response.ok) {
    set({ error: response.error });
    return;
  }
  const history = response.value;
  const previous = get().history;
  const resized = previous === null || previous.width !== history.width ||
    previous.height !== history.height;

  set({
    history,
    pendingAdjustments: null,
    // An adjustment changes colour without changing shape, so the counter has
    // to move even when the size did not, or the canvas would keep the old
    // preview on screen.
    fitRequest: get().fitRequest + 1,
    fitOnRequest: resized,
  });
}

/** What the panel should show: the pending move, or what the engine confirmed. */
export function currentAdjustments(state: EditorState): Adjustments {
  return state.pendingAdjustments ?? state.history?.adjustments ?? NEUTRAL_ADJUSTMENTS;
}

/**
 * The size the document currently renders at.
 *
 * The edit stack decides this, not the file: a rotated document is taller than
 * the JPEG it came from, and everything that lays out the canvas needs the
 * former.
 */
export function renderedSize(state: EditorState): { width: number; height: number } | null {
  if (state.history !== null) return { width: state.history.width, height: state.history.height };
  if (state.document !== null) {
    return { width: state.document.image.width, height: state.document.image.height };
  }
  return null;
}

export const useEditor = create<EditorState>((set, get) => ({
  engineState: 'starting',
  document: null,
  history: null,
  pendingAdjustments: null,
  preview: null,
  viewport: INITIAL_VIEWPORT,
  busy: null,
  error: null,
  lastExport: null,
  fitRequest: 0,
  fitOnRequest: false,

  setEngineState: (engineState) => set({ engineState }),

  openDialog: async () => {
    set({ busy: 'opening', error: null });
    const response = await window.photoy.openImageDialog();
    if (!response.ok) {
      set({ busy: null, error: response.error });
      return;
    }
    if (response.value === null) {
      set({ busy: null }); // the user cancelled; not an error
      return;
    }
    await get().closeDocument();
    set({
      document: response.value,
      history: null,
      pendingAdjustments: null,
      preview: null,
      viewport: INITIAL_VIEWPORT,
      busy: null,
    });
  },

  openPath: async (path) => {
    set({ busy: 'opening', error: null });
    const response = await window.photoy.openImagePath(path);
    if (!response.ok) {
      set({ busy: null, error: response.error });
      return;
    }
    await get().closeDocument();
    set({
      document: response.value,
      history: null,
      pendingAdjustments: null,
      preview: null,
      viewport: INITIAL_VIEWPORT,
      busy: null,
    });
  },

  closeDocument: async () => {
    const current = get().document;
    if (current === null) return;
    get().preview?.bitmap.close();
    set({
      document: null,
      history: null,
      pendingAdjustments: null,
      preview: null,
      lastExport: null,
    });
    await window.photoy.closeImage(current.id);
  },

  requestPreview: async (targetWidth, targetHeight) => {
    const document = get().document;
    if (document === null) return;

    // Renders overlap: a superseded one must not clear the busy state that the
    // render replacing it is still holding, nor install its stale bitmap.
    const token = previewToken + 1;
    previewToken = token;
    const isCurrent = () => previewToken === token && get().document?.id === document.id;

    set({ busy: 'rendering' });
    const response = await window.photoy.renderPreview({
      documentId: document.id,
      maxWidth: Math.max(1, Math.round(targetWidth)),
      maxHeight: Math.max(1, Math.round(targetHeight)),
    });
    if (!response.ok) {
      // A superseded render is the queue working as intended, not a failure the
      // user needs to hear about.
      if (response.error.code === 'cancelled') return;
      if (isCurrent()) set({ busy: null, error: response.error });
      return;
    }

    const bitmap = await toBitmap(response.value);
    // The document may have been closed, or another render finished, while this
    // preview was in flight.
    if (!isCurrent()) {
      bitmap.close();
      return;
    }
    get().preview?.bitmap.close();
    set({
      preview: {
        bitmap,
        width: response.value.width,
        height: response.value.height,
        scale: response.value.scale,
      },
      busy: null,
    });
  },

  exportImage: async (options) => {
    const document = get().document;
    if (document === null) return;

    const { format } = options;
    const extension = format === 'jpeg' ? 'jpg' : format === 'tiff' ? 'tif' : format;
    const baseName = document.image.fileName.replace(/\.[^.]+$/, '');
    const chosen = await window.photoy.chooseExportPath(`${baseName}.${extension}`);
    if (!chosen.ok) {
      set({ error: chosen.error });
      return;
    }
    if (chosen.value === null) return; // cancelled

    set({ busy: 'exporting', error: null });
    const request: ExportRequest = {
      documentId: document.id,
      path: chosen.value,
      format,
      quality: options.quality,
      colorSpace: options.colorSpace,
      sixteenBit: options.sixteenBit,
      preserveMetadata: options.preserveMetadata,
    };
    const response = await window.photoy.exportImage(request);
    if (!response.ok) {
      set({ busy: null, error: response.error });
      return;
    }
    set({ busy: null, lastExport: response.value });
  },

  applyEdit: async (operation) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(set, get, await window.photoy.applyEdit(document.id, operation));
  },

  setAdjustment: async (key, value, continuing) => {
    const document = get().document;
    if (document === null) return;

    const next: Adjustments = { ...currentAdjustments(get()), [key]: value };
    // The panel reflects the move immediately; the engine confirms a moment
    // later. Waiting for the round trip would make the slider feel tethered.
    set({ pendingAdjustments: next });
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'adjust', adjustments: next }, continuing),
    );
  },

  resetAdjustments: async () => {
    const document = get().document;
    if (document === null) return;
    set({ pendingAdjustments: NEUTRAL_ADJUSTMENTS });
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, {
        kind: 'adjust',
        adjustments: NEUTRAL_ADJUSTMENTS,
      }),
    );
  },

  undo: async () => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(set, get, await window.photoy.undoEdit(document.id));
  },

  redo: async () => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(set, get, await window.photoy.redoEdit(document.id));
  },

  resetEdits: async () => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(set, get, await window.photoy.resetEdits(document.id));
  },

  setViewport: (next) => set((state) => ({ viewport: { ...state.viewport, ...next } })),

  fitToViewport: (viewportWidth, viewportHeight) => {
    const size = renderedSize(get());
    if (size === null || viewportWidth <= 0 || viewportHeight <= 0) return;
    // A margin keeps the 1px hairline around the photo off the chrome edge.
    const margin = 48;
    const fitScale = Math.min(
      (viewportWidth - margin) / size.width,
      (viewportHeight - margin) / size.height,
    );
    const scale = clampScale(Math.min(fitScale, 1));
    set({ viewport: { scale, offsetX: 0, offsetY: 0, fitScale: scale } });
  },

  zoomAt: (factor, anchorX, anchorY) => {
    const { viewport } = get();
    const scale = clampScale(viewport.scale * factor);
    if (scale === viewport.scale) return;
    // Keep the point under the cursor fixed: the offset has to absorb the
    // change in how far that point sits from the viewport centre.
    const ratio = scale / viewport.scale;
    set({
      viewport: {
        ...viewport,
        scale,
        offsetX: anchorX - (anchorX - viewport.offsetX) * ratio,
        offsetY: anchorY - (anchorY - viewport.offsetY) * ratio,
      },
    });
  },

  panBy: (deltaX, deltaY) =>
    set((state) => ({
      viewport: {
        ...state.viewport,
        offsetX: state.viewport.offsetX + deltaX,
        offsetY: state.viewport.offsetY + deltaY,
      },
    })),

  dismissError: () => set({ error: null }),
  dismissExport: () => set({ lastExport: null }),
}));
