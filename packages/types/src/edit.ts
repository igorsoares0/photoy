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
  | 'adjust'
  | 'addLayer'
  | 'removeLayer'
  | 'reorderLayer'
  | 'setLayerVisible'
  | 'setLayerOpacity'
  | 'setLayerBlend'
  | 'setLayerMask';

export type MaskKind = 'none' | 'linear' | 'radial';

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
}

export const NO_MASK: Mask = {
  kind: 'none',
  x: 0.5,
  y: 0.5,
  angle: 0,
  radius: 0.35,
  feather: 0.25,
  invert: false,
};

export type LayerKind = 'background' | 'adjustment';

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
}
