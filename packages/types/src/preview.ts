import type { DocumentId } from './document.js';
import type { OutputSpace, PixelFormat } from './image.js';

/**
 * Ask the engine for a rendered view of a document, bounded by a box. The
 * engine never upscales: the result is at most the document's own resolution.
 */
export interface PreviewRequest {
  documentId: DocumentId;
  /** Upper bound for the returned width, in pixels. */
  maxWidth: number;
  /** Upper bound for the returned height, in pixels. */
  maxHeight: number;
}

/** Metadata describing a preview buffer. The pixels travel out of band. */
export interface PreviewInfo {
  documentId: DocumentId;
  width: number;
  height: number;
  /** Bytes per row, which may exceed width * 4 if the engine pads rows. */
  stride: number;
  format: PixelFormat;
  /** Space the preview was converted into. Always sRGB, for the screen. */
  colorSpace: OutputSpace;
  /** Full-resolution size the edit stack produces, which the preview fits into. */
  documentWidth: number;
  documentHeight: number;
  /** Rendered width divided by document width, in the range (0, 1]. */
  scale: number;
}

/** A preview together with its pixel buffer, as delivered to the renderer. */
export interface Preview extends PreviewInfo {
  pixels: ArrayBuffer;
}
