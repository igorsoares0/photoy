/**
 * The edit stack.
 *
 * Operations carry parameters and nothing else - no pixels, no cached result.
 * That is what makes undo a move of a cursor rather than a restore, and what
 * will make a project file small enough to be worth versioning.
 */

export type OperationKind = 'rotate' | 'flipHorizontal' | 'flipVertical' | 'crop' | 'adjust';

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
}

export type Operation = RotateOperation | FlipOperation | CropOperation | AdjustOperation;

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
  /** The adjustment state in effect, which is the last one recorded. */
  adjustments: Adjustments;
  /** Size the stack currently produces, which is what the viewport fits to. */
  width: number;
  height: number;
}
