/** Pixel layouts the engine can hand back to the host. */
export type PixelFormat = 'rgba8';

/** Container formats supported for import and export in milestone 1. */
export type ImageFormat = 'jpeg' | 'png' | 'tiff' | 'webp';

/**
 * Colour spaces the engine can write out.
 *
 * The engine edits in a wide linear space regardless; this is only what a file
 * leaving the engine gets converted into and tagged with.
 */
export type OutputSpace = 'srgb' | 'display-p3' | 'adobe-rgb';

/**
 * EXIF orientation as stored in tag 0x0112. The engine always resolves this
 * during decode, so pixels reaching the host are already upright; the value is
 * reported only so the UI can surface what the file claimed.
 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface ImageInfo {
  /** Absolute path the image was decoded from. */
  path: string;
  /** File name including extension. */
  fileName: string;
  /** Detected container format. */
  format: ImageFormat;
  /** Pixel dimensions of the file itself, before anything in the edit stack. */
  sourceWidth: number;
  sourceHeight: number;
  /** Dimensions the edit stack currently produces. Equal to the source when empty. */
  width: number;
  height: number;
  /** Bit depth per channel in the source file, before normalisation to rgba8. */
  bitDepth: number;
  /** True when the source carried an alpha channel. */
  hasAlpha: boolean;
  /** Orientation declared by the file, already applied to the decoded pixels. */
  orientation: ExifOrientation;
  /** Size of the source file in bytes. */
  fileSize: number;
  /**
   * Whether the file carried a usable ICC profile. An untagged file is read as
   * sRGB, which is the right assumption but still an assumption worth showing.
   */
  tagged: boolean;
  /** Description of the embedded profile. Empty when the file was untagged. */
  sourceProfile: string;
}
