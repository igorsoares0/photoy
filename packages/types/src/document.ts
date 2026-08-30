import type { ImageInfo } from './image.js';

/** Opaque handle to an image opened inside the native engine. */
export type DocumentId = string;

export interface DocumentInfo {
  id: DocumentId;
  image: ImageInfo;
}
