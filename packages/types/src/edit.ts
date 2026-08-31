/**
 * The edit stack.
 *
 * Operations carry parameters and nothing else - no pixels, no cached result.
 * That is what makes undo a move of a cursor rather than a restore, and what
 * will make a project file small enough to be worth versioning.
 */

export type OperationKind =
  | 'rotate'
  | 'flipHorizontal'
  | 'flipVertical'
  | 'crop'
  | 'resize'
  | 'adjust'
  | 'addLayer'
  | 'removeLayer'
  | 'reorderLayer'
  | 'setLayerVisible'
  | 'setLayerOpacity'
  | 'setLayerBlend'
  | 'setLayerMask'
  | 'setLayerFill'
  | 'setLayerDecontaminate'
  | 'setLayerPatch';

export type MaskKind = 'none' | 'linear' | 'radial' | 'raster';

/**
 * A parametric mask.
 *
 * Described rather than painted: coordinates are fractions of the document and
 * distances are in units of its shorter side, so the mask means the same thing
 * at preview size and at full resolution with nothing resampled in between.
 */
export interface Mask {
  kind: MaskKind;
  /** Midpoint of the transition, as a fraction of the document. */
  x: number;
  y: number;
  /** Direction of a linear gradient, in radians. Zero points down the frame. */
  angle: number;
  /** Radius of a radial mask, in units of the shorter side. */
  radius: number;
  /** Width of the transition. Zero is a hard edge. */
  feather: number;
  invert: boolean;
  /**
   * Levels on the coverage: below `low` nothing, above `high` everything.
   *
   * A segmentation model returns confidence, not a selection. Shipping that
   * confidence raw is what haloes hair and leaves faint ghosts of the old
   * background floating in the frame; these two are its black and white points.
   */
  low: number;
  high: number;
  /** kind 'raster': which stored buffer this refers to. Zero means none. */
  raster: number;
  /**
   * Document size the raster was generated for.
   *
   * A crop or a rotation afterwards moves every pixel underneath it, so a mask
   * whose size no longer matches the document is dropped rather than stretched.
   */
  rasterWidth: number;
  rasterHeight: number;
}

export const NO_MASK: Mask = {
  kind: 'none',
  x: 0.5,
  y: 0.5,
  angle: 0,
  radius: 0.35,
  feather: 0.25,
  invert: false,
  low: 0,
  high: 1,
  raster: 0,
  rasterWidth: 0,
  rasterHeight: 0,
};

/**
 * Levels a freshly segmented mask starts at.
 *
 * Not identity, because identity is measurably wrong: on a real photograph the
 * model left a diagonal smear of background behind, never rising above 29 per
 * cent confidence, and a broad soft collar around the hair. A black point of
 * 0.25 is where that smear measured down to one per cent of its area while the
 * hair kept thirty; the white point is judgement rather than measurement, set
 * gently because nothing distinguished the candidates. Both are sliders, so a
 * subject that really is soft can have the range back.
 *
 * Calibrated against one photograph, which is one more than the synthetic
 * fixtures offer and far fewer than this deserves.
 */
export const SEGMENTED_LEVELS = { low: 0.25, high: 0.8 } as const;

/** True when a raster mask no longer lines up with the document under it. */
export function isMaskStale(mask: Mask, width: number, height: number): boolean {
  return mask.kind === 'raster' && (mask.rasterWidth !== width || mask.rasterHeight !== height);
}

export type LayerKind = 'background' | 'adjustment' | 'matte' | 'patch';

/** What takes the place of what a matte layer removes. */
export type FillKind = 'transparent' | 'color';

/** A picked colour, in sRGB, 0 to 1 per channel. */
export interface FillColor {
  r: number;
  g: number;
  b: number;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light';

/**
 * A layer as the engine reports it.
 *
 * The bottom of every stack is the background — the decoded original, which
 * cannot be removed, reordered or adjusted. It is the visual proof of the
 * non-destructive model.
 */
export interface Layer {
  id: number;
  kind: LayerKind;
  visible: boolean;
  /** 0 to 1. */
  opacity: number;
  blend: BlendMode;
  name: string;
  /** kind 'matte': what replaces the part the mask excludes. */
  fill: FillKind;
  color: FillColor;
  /** kind 'matte': how much of the old background's colour to unmix, 0 to 1. */
  decontaminate: number;
  /**
   * kind 'patch': the stored pixels this layer draws, and what they were made
   * against.
   *
   * The patch is what the model invented; the layer's mask decides how much of
   * it is used, which is what lets the marked area be trimmed afterwards
   * without the model running again.
   */
  patch: number;
  patchWidth: number;
  patchHeight: number;
  adjustments: Adjustments;
  /** Where the layer applies. `kind: 'none'` means everywhere. */
  mask: Mask;
}

/**
 * The basic adjustment set. Every value is neutral at zero.
 *
 * Exposure is in stops, so it is the one control whose effect is defined rather
 * than tuned. The rest run -100 to 100 and are a matter of response design.
 */
export interface Adjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
  temperature: number;
}

export type AdjustmentKey = keyof Adjustments;

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
};

/** A rectangle in pixel coordinates, half-open on the right and bottom. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RotateOperation {
  kind: 'rotate';
  /** Clockwise quarter turns, 1 to 3. */
  quarters: number;
}

export interface FlipOperation {
  kind: 'flipHorizontal' | 'flipVertical';
}

export interface CropOperation {
  kind: 'crop';
  /** The kept region, in the coordinates the preceding operations produce. */
  rect: Rect;
}

export interface AdjustOperation {
  kind: 'adjust';
  /** The complete slider state, not a delta. */
  adjustments: Adjustments;
  /** Omitted targets the topmost adjustment layer, creating one if needed. */
  layerId?: number;
}

export interface AddLayerOperation {
  kind: 'addLayer';
  name?: string;
  /** Defaults to an adjustment layer. */
  layerKind?: LayerKind;
}

/**
 * An explicit output size.
 *
 * Non-destructive like every other transformation: the source keeps all its
 * pixels and this says how many they become on the way out, so it can be undone
 * or changed without the photograph having been resampled twice.
 */
export interface ResizeOperation {
  kind: 'resize';
  width: number;
  height: number;
}

export interface SetLayerPatchOperation {
  kind: 'setLayerPatch';
  layerId: number;
  patch: number;
  patchWidth: number;
  patchHeight: number;
}

export interface SetLayerDecontaminateOperation {
  kind: 'setLayerDecontaminate';
  layerId: number;
  decontaminate: number;
}

export interface SetLayerFillOperation {
  kind: 'setLayerFill';
  layerId: number;
  fill: FillKind;
  color?: FillColor;
}

export interface LayerOperation {
  kind:
    | 'removeLayer'
    | 'reorderLayer'
    | 'setLayerVisible'
    | 'setLayerOpacity'
    | 'setLayerBlend'
    | 'setLayerMask';
  layerId: number;
  /** reorderLayer: position from the bottom, where 0 is the background. */
  index?: number;
  visible?: boolean;
  opacity?: number;
  blend?: BlendMode;
  mask?: Mask;
}

export type Operation =
  | RotateOperation
  | FlipOperation
  | CropOperation
  | AdjustOperation
  | AddLayerOperation
  | SetLayerFillOperation
  | SetLayerDecontaminateOperation
  | ResizeOperation
  | SetLayerPatchOperation
  | LayerOperation;

/** An operation as it comes back from the engine, with its assigned id. */
export type HistoryEntry = Operation & { id: number };

export interface EditHistory {
  documentId: string;
  /** Every entry recorded, including the redo tail past the cursor. */
  entries: HistoryEntry[];
  /** How many entries are in effect. Entries past this are redoable. */
  cursor: number;
  canUndo: boolean;
  canRedo: boolean;
  /** The layer stack, bottom first — the order it composites in. */
  layers: Layer[];
  /** The adjustment state of the topmost adjustment layer. */
  adjustments: Adjustments;
  /** Size the stack currently produces, which is what the viewport fits to. */
  width: number;
  height: number;
  /**
   * Size the crop and the orientation alone produce, before any resize.
   *
   * A raster mask belongs to this rather than to `width`/`height`: a resize
   * scales every pixel together and leaves the mask meaning what it meant,
   * while a crop or a rotation moves them apart.
   */
  naturalWidth: number;
  naturalHeight: number;
}
