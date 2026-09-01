import { create } from 'zustand';
import type {
  AdjustmentKey,
  Adjustments,
  BlendMode,
  FillColor,
  FillKind,
  Layer,
  Mask,
  Rect,
  DocumentInfo,
  EditHistory,
  ExportRequest,
  ExportResult,
  ImageFormat,
  Operation,
  OutputSpace,
} from '@photoy/types';
import { NEUTRAL_ADJUSTMENTS, NO_MASK, SEGMENTED_LEVELS } from '@photoy/types';
import type { Preset, PresetCategory } from '@photoy/types';
import type { ApiResult, EngineState, OpenedProject, RecoveryOffer } from '@photoy/ipc';
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

export type Busy = 'opening' | 'rendering' | 'exporting' | 'segmenting' | 'filling' | null;

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
  /** Which layer the sliders and the panel act on. */
  selectedLayerId: number | null;
  /** Path of the .myphoto this document is saved as, or null if never saved. */
  projectPath: string | null;
  /** True when there are edits the saved project does not contain. */
  dirty: boolean;
  /** An unfinished session from a previous run, waiting on the user's answer. */
  recovery: RecoveryOffer | null;
  /**
   * The crop being composed, in document coordinates, or null when the tool is
   * not active. Nothing is applied until it is confirmed: framing is a decision,
   * and the stack should record the decision, not every rectangle tried on the
   * way to it.
   */
  cropRect: Rect | null;
  /** Width over height the crop is locked to, or null for a free rectangle. */
  cropAspect: number | null;
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
  /** Files opened before, newest first, with the ones that vanished dropped. */
  recent: string[];
  loadRecent(): Promise<void>;
  closeDocument(): Promise<void>;
  /**
   * True while a slider is being dragged, between the first frame and release.
   *
   * The canvas renders a draft at reduced resolution while this holds and a
   * full one when it clears, which is what keeps a drag responsive without
   * leaving a soft picture on screen once the hand comes off.
   */
  interacting: boolean;

  /**
   * The mask brush: null when the tool is off, its settings when it is on.
   *
   * A hard round brush and nothing else. Overlapping opaque strokes are
   * idempotent, which is what keeps a stroke free of the seams a soft brush
   * accumulates where it crosses itself - and a hard mask is what inpainting
   * wants anyway. Softness, if it is ever wanted, is already available as the
   * mask's own black and white points.
   */
  brush: { size: number; mode: 'add' | 'erase' } | null;
  /**
   * Starts an object removal: a patch layer, selected, with the brush on.
   *
   * The layer's mask is both what marks the object and what blends the fill,
   * which is what lets the mark be trimmed afterwards without the model running
   * again. Until it is filled the layer draws nothing, so the picture does not
   * change while you are still deciding what to paint over.
   */
  beginObjectRemoval(): Promise<void>;
  /** Runs the model over what is marked and hangs the result on the layer. */
  fillMarked(layerId: number): Promise<void>;
  beginBrush(): void;
  endBrush(): void;
  setBrush(patch: Partial<{ size: number; mode: 'add' | 'erase' }>): void;
  /** Hands a painted mask to the engine and hangs it on the layer. */
  applyPaintedMask(
    layerId: number,
    width: number,
    height: number,
    coverage: Uint8Array,
  ): Promise<void>;
  requestPreview(targetWidth: number, targetHeight: number): Promise<void>;

  /**
   * The comparison view: the photograph framed as it is now, with nothing done
   * to it.
   *
   * Kept beside the live preview rather than swapped into it, so that holding
   * the control is instant after the first time and releasing it is instant
   * always. It is dropped whenever the stack changes, because then it is a
   * picture of something that is no longer the before.
   */
  comparing: boolean;
  baseline: PreviewState | null;
  setComparing(on: boolean): Promise<void>;

  applyEdit(operation: Operation): Promise<void>;

  /** Reads the stack from the engine, so the panel knows it before any edit. */
  refreshHistory(): Promise<void>;

  setProjectState(state: { path: string | null; dirty: boolean }): void;
  offerRecovery(offer: RecoveryOffer | null): void;
  openProject(): Promise<void>;
  saveProject(): Promise<void>;
  saveProjectAs(): Promise<void>;
  takeRecovery(): Promise<void>;
  discardRecovery(): Promise<void>;
  selectLayer(id: number): void;
  addLayer(): Promise<void>;
  removeLayer(id: number): Promise<void>;
  setLayerVisible(id: number, visible: boolean): Promise<void>;
  setLayerOpacity(id: number, opacity: number, continuing: boolean): Promise<void>;
  setLayerBlend(id: number, blend: BlendMode): Promise<void>;
  setLayerMask(id: number, mask: Mask, continuing?: boolean): Promise<void>;
  /** Runs segmentation and attaches the result to the layer as its mask. */
  segmentIntoMask(id: number): Promise<void>;
  /** Segments the subject and cuts everything else away, as one action. */
  removeBackground(): Promise<void>;
  setLayerFill(id: number, fill: FillKind, color?: FillColor, blur?: number): Promise<void>;
  setLayerDecontaminate(id: number, amount: number, continuing: boolean): Promise<void>;
  /** Asks for an image and makes it the background of a matte layer. */
  chooseBackgroundImage(layerId: number): Promise<void>;
  moveLayer(id: number, delta: number): Promise<void>;

  beginCrop(): void;
  setCropRect(rect: Rect): void;
  setCropAspect(aspect: number | null): void;
  confirmCrop(): Promise<void>;
  cancelCrop(): void;

  /**
   * Moves one slider. `continuing` is true for every frame of a drag after the
   * first, which is what makes the gesture a single undo step.
   */
  setAdjustment(key: AdjustmentKey, value: number, continuing: boolean): Promise<void>;

  /** The user's own presets. The built-in ones are a constant, not state. */
  presets: Preset[];
  loadPresets(): Promise<void>;
  applyPreset(preset: Preset): Promise<void>;
  savePreset(name: string, category: PresetCategory): Promise<void>;
  deletePreset(id: string): Promise<void>;
  resetAdjustments(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  resetEdits(): Promise<void>;
  seekEdit(cursor: number): Promise<void>;
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
  continuing = false,
): Promise<void> {
  if (!response.ok) {
    set({ error: response.error });
    return;
  }
  const history = response.value;
  const previous = get().history;
  const resized = previous === null || previous.width !== history.width ||
    previous.height !== history.height;

  get().baseline?.bitmap.close();
  set({
    history,
    // A comparison of the picture against a stack that has since changed would
    // be a comparison against nothing in particular.
    baseline: null,
    // Held for the canvas: mid-gesture it renders a draft, and the frame that
    // ends the gesture is the one that gets rendered in full.
    interacting: continuing,
    pendingAdjustments: null,
    // An adjustment changes colour without changing shape, so the counter has
    // to move even when the size did not, or the canvas would keep the old
    // preview on screen.
    fitRequest: get().fitRequest + 1,
    fitOnRequest: resized,
  });
}

/**
 * Stable empty stack.
 *
 * A selector must return the same reference when nothing changed. Writing
 * `?? []` inside one builds a fresh array on every call, the store sees a change
 * every time, and the component re-renders until React gives up.
 */
export const NO_LAYERS: readonly Layer[] = [];

/** The layer the panel is acting on: the chosen one, or the topmost adjustment. */
export function selectedLayer(state: EditorState): Layer | null {
  const layers = state.history?.layers ?? NO_LAYERS;
  if (layers.length === 0) return null;
  const chosen = layers.find((layer) => layer.id === state.selectedLayerId);
  if (chosen !== undefined) return chosen;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (layer !== undefined && layer.kind === 'adjustment') return layer;
  }
  return layers[0] ?? null;
}

/** What the panel should show: the pending move, or what the engine confirmed. */
export function currentAdjustments(state: EditorState): Adjustments {
  return state.pendingAdjustments ?? selectedLayer(state)?.adjustments ?? NEUTRAL_ADJUSTMENTS;
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

/** Installs a document that arrived with its stack already loaded. */
function adoptProject(set: SetState, get: GetState, opened: OpenedProject): void {
  get().preview?.bitmap.close();
  set({
    document: opened.document,
    history: opened.history,
    projectPath: opened.path,
    dirty: false,
    pendingAdjustments: null,
    selectedLayerId: null,
    cropRect: null,
    preview: null,
    viewport: { scale: 1, offsetX: 0, offsetY: 0, fitScale: 1 },
    lastExport: null,
    busy: null,
  });
}

export const useEditor = create<EditorState>((set, get) => ({
  engineState: 'starting',
  document: null,
  history: null,
  pendingAdjustments: null,
  selectedLayerId: null,
  projectPath: null,
  dirty: false,
  recovery: null,
  cropRect: null,
  cropAspect: null,
  preview: null,
  viewport: INITIAL_VIEWPORT,
  busy: null,
  error: null,
  lastExport: null,
  fitRequest: 0,
  fitOnRequest: false,
  interacting: false,
  brush: null,
  presets: [],
  recent: [],
  comparing: false,
  baseline: null,

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
      selectedLayerId: null,
      cropRect: null,
      preview: null,
      viewport: INITIAL_VIEWPORT,
      busy: null,
    });
    await get().refreshHistory();
  },

  openPath: async (path) => {
    // The recent list holds both photographs and projects, and they are opened
    // by different doors: a project carries an edit stack, a photograph does
    // not, and reading one as the other loses everything or fails outright.
    if (/\.myphoto$/i.test(path)) {
      set({ busy: 'opening', error: null });
      const project = await window.photoy.openProjectPath(path);
      set({ busy: null });
      if (!project.ok) {
        set({ error: project.error });
        return;
      }
      adoptProject(set, get, project.value);
      return;
    }

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
      selectedLayerId: null,
      cropRect: null,
      preview: null,
      viewport: INITIAL_VIEWPORT,
      busy: null,
    });
    await get().refreshHistory();
  },

  closeDocument: async () => {
    const current = get().document;
    if (current === null) return;
    get().preview?.bitmap.close();
    set({
      document: null,
      history: null,
      pendingAdjustments: null,
      cropRect: null,
      preview: null,
      lastExport: null,
    });
    await window.photoy.closeImage(current.id);
  },

  setComparing: async (on) => {
    set({ comparing: on });
    if (!on) return;

    const document = get().document;
    const preview = get().preview;
    if (document === null || preview === null || get().baseline !== null) return;

    const response = await window.photoy.renderPreview({
      documentId: document.id,
      maxWidth: preview.width,
      maxHeight: preview.height,
      baseline: true,
    });
    if (!response.ok) return;
    const bitmap = await toBitmap(response.value);
    // The document may have been closed, or the comparison let go, in the
    // meantime; a bitmap nobody will draw has to be released rather than kept.
    if (get().document?.id !== document.id) {
      bitmap.close();
      return;
    }
    get().baseline?.bitmap.close();
    set({
      baseline: {
        bitmap,
        width: response.value.width,
        height: response.value.height,
        scale: response.value.scale,
      },
    });
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

  setProjectState: ({ path, dirty }) => set({ projectPath: path, dirty }),
  offerRecovery: (recovery) => set({ recovery }),

  openProject: async () => {
    set({ busy: 'opening', error: null });
    const response = await window.photoy.openProject();
    if (!response.ok) {
      set({ busy: null, error: response.error });
      return;
    }
    set({ busy: null });
    if (response.value !== null) adoptProject(set, get, response.value);
  },

  saveProject: async () => {
    const response = await window.photoy.saveProject();
    if (!response.ok) set({ error: response.error });
  },

  saveProjectAs: async () => {
    const response = await window.photoy.saveProjectAs();
    if (!response.ok) set({ error: response.error });
  },

  takeRecovery: async () => {
    set({ busy: 'opening', recovery: null, error: null });
    const response = await window.photoy.takeRecovery();
    if (!response.ok) {
      set({ busy: null, error: response.error });
      return;
    }
    set({ busy: null });
    if (response.value !== null) adoptProject(set, get, response.value);
  },

  discardRecovery: async () => {
    set({ recovery: null });
    await window.photoy.discardRecovery();
  },

  refreshHistory: async () => {
    const document = get().document;
    if (document === null) return;
    const response = await window.photoy.readHistory(document.id);
    // Adopting would bump the render counter; reading the stack changes nothing
    // on screen, so it only updates what the panel shows.
    if (response.ok) set({ history: response.value });
  },

  selectLayer: (selectedLayerId) => set({ selectedLayerId, pendingAdjustments: null }),

  addLayer: async () => {
    const document = get().document;
    if (document === null) return;
    const before = get().history?.layers.map((layer) => layer.id) ?? [];
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'addLayer', name: 'Ajuste' }),
    );
    // Select what was just created, so the sliders act on it straight away.
    const created = get().history?.layers.find((layer) => !before.includes(layer.id));
    if (created !== undefined) set({ selectedLayerId: created.id });
  },

  removeLayer: async (id) => {
    const document = get().document;
    if (document === null) return;
    if (get().selectedLayerId === id) set({ selectedLayerId: null });
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'removeLayer', layerId: id }),
    );
  },

  setLayerVisible: async (id, visible) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'setLayerVisible', layerId: id, visible }),
    );
  },

  setLayerOpacity: async (id, opacity, continuing) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(
        document.id,
        { kind: 'setLayerOpacity', layerId: id, opacity },
        continuing,
      ),
      continuing,
    );
  },

  setLayerBlend: async (id, blend) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'setLayerBlend', layerId: id, blend }),
    );
  },

  setLayerMask: async (id, mask, continuing = false) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'setLayerMask', layerId: id, mask }, continuing),
      continuing,
    );
  },

  segmentIntoMask: async (id) => {
    const document = get().document;
    if (document === null) return;

    set({ busy: 'segmenting', error: null });
    const segmented = await window.photoy.segment(document.id);
    if (!segmented.ok) {
      set({ busy: null, error: segmented.error });
      return;
    }
    set({ busy: null });
    await get().setLayerMask(id, {
      ...NO_MASK,
      ...SEGMENTED_LEVELS,
      kind: 'raster',
      raster: segmented.value.raster,
      rasterWidth: segmented.value.width,
      rasterHeight: segmented.value.height,
    });
  },

  setLayerFill: async (id, fill, color, blur) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, {
        kind: 'setLayerFill', layerId: id, fill, color, blur,
      }),
    );
  },

  beginObjectRemoval: async () => {
    const document = get().document;
    if (document === null) return;

    const before = get().history?.layers.map((layer) => layer.id) ?? [];
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, {
        kind: 'addLayer',
        layerKind: 'patch',
        name: 'Remoção',
      }),
    );
    const created = get().history?.layers.find((layer) => !before.includes(layer.id));
    if (created === undefined) return;
    set({ selectedLayerId: created.id, brush: get().brush ?? { size: 6, mode: 'add' }, cropRect: null });
  },

  fillMarked: async (layerId) => {
    const document = get().document;
    const layer = get().history?.layers.find((entry) => entry.id === layerId);
    if (document === null || layer === undefined) return;
    if (layer.mask.kind !== 'raster' || layer.mask.raster === 0) return;

    set({ busy: 'filling', error: null });
    const filled = await window.photoy.inpaint(document.id, layer.mask.raster);
    if (!filled.ok) {
      set({ busy: null, error: filled.error });
      return;
    }
    set({ busy: null });
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, {
        kind: 'setLayerPatch',
        layerId,
        patch: filled.value.patch,
        patchWidth: filled.value.documentWidth,
        patchHeight: filled.value.documentHeight,
      }),
    );
  },

  beginBrush: () => set({ brush: get().brush ?? { size: 6, mode: 'add' }, cropRect: null }),
  endBrush: () => set({ brush: null }),
  setBrush: (patch) => {
    const current = get().brush;
    if (current === null) return;
    set({ brush: { ...current, ...patch } });
  },

  applyPaintedMask: async (layerId, width, height, coverage) => {
    const document = get().document;
    if (document === null) return;

    const stored = await window.photoy.storeMask(document.id, width, height, coverage);
    if (!stored.ok) {
      set({ error: stored.error });
      return;
    }
    // The mask belongs to the crop and the orientation, not to the output size,
    // so it is recorded against the natural one.
    const history = get().history;
    await get().setLayerMask(layerId, {
      ...NO_MASK,
      kind: 'raster',
      raster: stored.value.raster,
      rasterWidth: history?.naturalWidth ?? width,
      rasterHeight: history?.naturalHeight ?? height,
    });
  },

  chooseBackgroundImage: async (layerId) => {
    const document = get().document;
    if (document === null) return;

    const chosen = await window.photoy.chooseBackground(document.id);
    if (!chosen.ok) {
      set({ error: chosen.error });
      return;
    }
    if (chosen.value === null) return; // dismissed

    // The backdrop is stored pixels placed in the document, which is what a
    // patch already is, so the layer points at it the same way.
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, {
        kind: 'setLayerPatch',
        layerId,
        patch: chosen.value.patch,
        patchWidth: chosen.value.patchWidth,
        patchHeight: chosen.value.patchHeight,
      }),
    );
    await get().setLayerFill(layerId, 'image');
  },

  setLayerDecontaminate: async (id, amount, continuing) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(
        document.id,
        { kind: 'setLayerDecontaminate', layerId: id, decontaminate: amount },
        continuing,
      ),
      continuing,
    );
  },

  removeBackground: async () => {
    const document = get().document;
    if (document === null) return;

    set({ busy: 'segmenting', error: null });
    const segmented = await window.photoy.segment(document.id);
    if (!segmented.ok) {
      set({ busy: null, error: segmented.error });
      return;
    }
    set({ busy: null });

    // Running it a second time redoes the removal rather than stacking a second
    // matte on top of the first, which would cut the subject away twice.
    let target = get().history?.layers.find((layer) => layer.kind === 'matte') ?? null;
    if (target === null) {
      const before = get().history?.layers.map((layer) => layer.id) ?? [];
      await adoptHistory(
        set,
        get,
        await window.photoy.applyEdit(document.id, {
          kind: 'addLayer',
          layerKind: 'matte',
          name: 'Fundo',
        }),
      );
      target = get().history?.layers.find((layer) => !before.includes(layer.id)) ?? null;
      if (target === null) return;
    }

    set({ selectedLayerId: target.id });
    await get().setLayerMask(target.id, {
      ...NO_MASK,
      ...SEGMENTED_LEVELS,
      kind: 'raster',
      raster: segmented.value.raster,
      rasterWidth: segmented.value.width,
      rasterHeight: segmented.value.height,
    });
  },

  moveLayer: async (id, delta) => {
    const document = get().document;
    const layers = get().history?.layers ?? [];
    const at = layers.findIndex((layer) => layer.id === id);
    if (document === null || at < 0) return;
    // The background holds index 0 and nothing may be placed below it.
    const target = Math.min(Math.max(1, at + delta), layers.length - 1);
    if (target === at) return;
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'reorderLayer', layerId: id, index: target }),
    );
  },

  beginCrop: () => {
    const size = renderedSize(get());
    if (size === null) return;
    set({
      cropRect: { x: 0, y: 0, width: size.width, height: size.height },
      cropAspect: null,
      brush: null,
    });
  },

  setCropRect: (cropRect) => set({ cropRect }),
  setCropAspect: (cropAspect) => set({ cropAspect }),
  cancelCrop: () => set({ cropRect: null, cropAspect: null }),

  confirmCrop: async () => {
    const { document, cropRect } = get();
    const size = renderedSize(get());
    if (document === null || cropRect === null || size === null) return;

    // A crop that changes nothing is not worth a history entry.
    const whole =
      cropRect.x === 0 && cropRect.y === 0 && cropRect.width === size.width &&
      cropRect.height === size.height;
    set({ cropRect: null, cropAspect: null });
    if (whole) return;

    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, { kind: 'crop', rect: cropRect }),
    );
  },

  loadRecent: async () => {
    const listed = await window.photoy.listRecent();
    if (listed.ok) set({ recent: listed.value });
  },

  loadPresets: async () => {
    const listed = await window.photoy.listPresets();
    if (listed.ok) set({ presets: listed.value });
  },

  applyPreset: async (preset) => {
    const document = get().document;
    if (document === null) return;
    const layerId = get().selectedLayerId ?? undefined;
    set({ pendingAdjustments: preset.adjustments });
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(document.id, {
        kind: 'adjust',
        adjustments: preset.adjustments,
        name: preset.name,
        ...(layerId === undefined ? {} : { layerId }),
      }),
    );
  },

  savePreset: async (name, category) => {
    const trimmed = name.trim();
    if (trimmed === '') return;
    const saved = await window.photoy.savePreset({
      // Time plus a random tail: two presets saved in the same millisecond are
      // unlikely, and a collision would silently overwrite the earlier one.
      id: `user.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      category,
      adjustments: currentAdjustments(get()),
    });
    if (saved.ok) set({ presets: saved.value });
    else set({ error: saved.error });
  },

  deletePreset: async (id) => {
    const removed = await window.photoy.deletePreset(id);
    if (removed.ok) set({ presets: removed.value });
  },

  setAdjustment: async (key, value, continuing) => {
    const document = get().document;
    if (document === null) return;

    const next: Adjustments = { ...currentAdjustments(get()), [key]: value };
    const layerId = get().selectedLayerId ?? undefined;
    // The panel reflects the move immediately; the engine confirms a moment
    // later. Waiting for the round trip would make the slider feel tethered.
    set({ pendingAdjustments: next });
    await adoptHistory(
      set,
      get,
      await window.photoy.applyEdit(
        document.id,
        layerId === undefined ? { kind: 'adjust', adjustments: next } : { kind: 'adjust', adjustments: next, layerId },
        continuing,
      ),
      continuing,
    );
  },

  seekEdit: async (cursor) => {
    const document = get().document;
    if (document === null) return;
    await adoptHistory(set, get, await window.photoy.seekEdit(document.id, cursor));
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
