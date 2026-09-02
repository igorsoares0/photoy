import type { Adjustments } from './edit.js';
import type { ExportFormat, OutputSpace } from './image.js';

/**
 * Browsing a folder, which is as much catalogue as the V1 has.
 *
 * The spec is explicit that no photographic catalogue is to be built, so
 * nothing here is imported, indexed or owned: the folder on disk is the truth,
 * a listing is a snapshot of it, and the only thing the application keeps of
 * its own is which paths were marked and which folders were visited.
 */
export interface LibraryEntry {
  path: string;
  name: string;
  /** Bytes on disk. */
  size: number;
  /** Last modified, in milliseconds since the epoch. */
  modified: number;
  favourite: boolean;
}

export interface LibraryFolder {
  path: string;
  entries: LibraryEntry[];
  /**
   * How many files were passed over because nothing here can decode them.
   *
   * Shown rather than hidden: a folder that lists eleven of its forty files
   * needs to say so, or it reads as a folder that lost the other twenty-nine.
   */
  skipped: number;
}

/**
 * A thumbnail as it crosses the bridge.
 *
 * The photograph's own pixel dimensions are deliberately not here. They are
 * known when the engine makes a thumbnail and not known when the answer comes
 * off disk, and carrying a field that is right half the time is worse than not
 * carrying it - the grid needs the tile's shape, which is in the JPEG, and the
 * editor reports the real size once a photograph is open.
 */
export interface ThumbnailResult {
  path: string;
  /** Size of the thumbnail, for the tile that holds it. */
  width: number;
  height: number;
  /** JPEG bytes, ready for an object URL. */
  bytes: ArrayBuffer;
  /** True when the answer came from disk rather than from the engine. */
  cached: boolean;
}

/**
 * Applying one look to many photographs and writing them all out.
 *
 * The adjustments travel whole rather than as a preset identifier, so a batch
 * is reproducible from what is in the request: a preset renamed or deleted
 * between the request and the run cannot change what the run does.
 */
export interface BatchRequest {
  paths: string[];
  /** Applied to every photograph, or null to export them as they are. */
  adjustments: Adjustments | null;
  /** Named only so the progress panel and the history can say what ran. */
  name: string;
  /** Where the files go. One per source, named after it. */
  targetDirectory: string;
  format: ExportFormat;
  quality?: number;
  colorSpace?: OutputSpace;
  /**
   * Longest side of the exported file, or null for the photograph's own size.
   *
   * The one transform a batch offers: "these all need to be 2048 across" is the
   * request every gallery and every client makes, and doing it per photograph
   * afterwards is the work a batch exists to remove.
   */
  maxSide: number | null;
  preserveMetadata?: boolean;
}

export type BatchOutcome = 'exported' | 'failed' | 'cancelled';

/** What happened to one photograph in a batch. */
export interface BatchItem {
  path: string;
  outcome: BatchOutcome;
  /** Where it was written, when it was. */
  target: string | null;
  /** Why it failed, in the product's own words. Null when it did not. */
  error: string | null;
}

export interface BatchProgress {
  /** How many are done, of how many were asked for. */
  done: number;
  total: number;
  /** The file being worked on now, or null between items. */
  current: string | null;
}

export interface BatchResult {
  items: BatchItem[];
  exported: number;
  failed: number;
  cancelled: boolean;
  durationMs: number;
}
