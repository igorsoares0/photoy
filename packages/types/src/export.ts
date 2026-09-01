import type { DocumentId } from './document.js';
import type { ExportFormat, OutputSpace } from './image.js';

export interface ExportRequest {
  documentId: DocumentId;
  /** Absolute destination path. The engine writes atomically via a temp file. */
  path: string;
  format: ExportFormat;
  /**
   * Encoder quality, 1-100. Applies to jpeg and lossy webp; ignored by png and
   * tiff, which are always lossless here.
   */
  quality?: number;
  /** Space to convert into and tag the file with. Defaults to sRGB. */
  colorSpace?: OutputSpace;
  /**
   * Ask for 16 bits per channel. Only PNG and TIFF can honour it; the engine
   * defaults it on when the source image had the depth to justify it.
   */
  sixteenBit?: boolean;
  /** Copy EXIF from the source file when the target format can carry it. */
  preserveMetadata?: boolean;
}

export interface ExportResult {
  path: string;
  format: ExportFormat;
  /** Space the file was actually written in. */
  colorSpace: OutputSpace;
  /** Bits per channel actually written, which the format may have capped. */
  bitDepth: number;
  width: number;
  height: number;
  bytesWritten: number;
  /** Wall-clock duration of the encode, in milliseconds. */
  durationMs: number;
}
