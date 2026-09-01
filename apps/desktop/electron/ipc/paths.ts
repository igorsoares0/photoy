import path from 'node:path';
import { statSync } from 'node:fs';

/**
 * Extensions of the raw formats the engine decodes through LibRaw.
 *
 * A hint, not a decision: the engine sniffs the file itself, and most of these
 * are TIFF containers that a magic number cannot tell from an ordinary TIFF.
 * The list exists so the open dialog shows a photographer's files and the path
 * guard does not reject them before the engine ever sees the bytes.
 */
const RAW_EXTENSIONS = [
  '.3fr', '.arw', '.cr2', '.cr3', '.crw', '.dcr', '.dng', '.erf', '.iiq', '.kdc',
  '.mef', '.mos', '.mrw', '.nef', '.nrw', '.orf', '.pef', '.raf', '.raw', '.rw2',
  '.rwl', '.sr2', '.srf', '.srw', '.x3f',
];

/**
 * What phones save.
 *
 * Read through the operating system's own codec rather than one shipped here -
 * see the decoder for why - so on Windows these open only where the free HEIF
 * Image Extensions are installed. Listed anyway: the engine's refusal says what
 * to install, which is more use than a file the dialog would not even show.
 */
const HEIF_EXTENSIONS = ['.heic', '.heif'];

/** Extensions the engine can decode. Content is still sniffed on open. */
const READABLE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.jpe', '.png', '.tif', '.tiff', '.webp',
  ...HEIF_EXTENSIONS,
  ...RAW_EXTENSIONS,
]);

/**
 * Whether a path looks decodable, judged by extension alone.
 *
 * For the places that hold a string and no file yet - a command line argument,
 * a shell file association. Anything that has the bytes should sniff them.
 */
export function hasReadableExtension(candidate: string): boolean {
  return READABLE_EXTENSIONS.has(path.extname(candidate).toLowerCase());
}

/**
 * Open-dialog filters, derived from the sets above so the dialog and the guard
 * cannot disagree about what opens.
 */
export const OPEN_FILTERS = [
  {
    name: 'Imagens',
    extensions: [...READABLE_EXTENSIONS].map((extension) => extension.slice(1)),
  },
  { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { name: 'PNG', extensions: ['png'] },
  { name: 'TIFF', extensions: ['tif', 'tiff'] },
  { name: 'WebP', extensions: ['webp'] },
  { name: 'RAW', extensions: RAW_EXTENSIONS.map((extension) => extension.slice(1)) },
  { name: 'HEIC', extensions: HEIF_EXTENSIONS.map((extension) => extension.slice(1)) },
];

/**
 * Save-dialog filters. A separate list rather than a slice of the one above,
 * because raw is decode-only: offering it as an export target would promise
 * something no encoder can deliver.
 */
export const EXPORT_FILTERS = [
  { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  { name: 'PNG', extensions: ['png'] },
  { name: 'TIFF', extensions: ['tif', 'tiff'] },
  { name: 'WebP', extensions: ['webp'] },
];

/**
 * The project container.
 *
 * Kept apart from the readable set rather than added to it: a project is not
 * something `image.open` can decode, and letting one through that door would
 * turn "open my project" into a decode failure with nothing to explain it.
 */
const PROJECT_EXTENSION = '.myphoto';

/** Extensions the engine can encode. */
const WRITABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);

export class PathRejected extends Error {
  readonly code = 'invalid_request';
  readonly detail: string;

  constructor(message: string, detail: string) {
    super(message);
    this.name = 'PathRejected';
    this.detail = detail;
  }
}

/**
 * Vets a path arriving from the renderer before it reaches the engine.
 *
 * The renderer is sandboxed but still the least trusted part of the app, and
 * drag-and-drop hands it arbitrary strings, so a path only passes if it is
 * absolute, resolves to a real file, and carries an extension we can decode.
 */
export function resolveReadablePath(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathRejected('Invalid file path', 'path must be a non-empty string');
  }
  const resolved = path.resolve(candidate);
  if (!path.isAbsolute(resolved)) {
    throw new PathRejected('Invalid file path', 'path must be absolute');
  }
  if (!READABLE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new PathRejected('Unsupported file type', path.extname(resolved) || 'no extension');
  }

  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new PathRejected('File not found', resolved);
  }
  if (!stats.isFile()) {
    throw new PathRejected('Not a file', resolved);
  }
  return resolved;
}

/** Vets a project path arriving from the renderer, for the recent list. */
export function resolveProjectPath(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathRejected('Invalid file path', 'path must be a non-empty string');
  }
  const resolved = path.resolve(candidate);
  if (path.extname(resolved).toLowerCase() !== PROJECT_EXTENSION) {
    throw new PathRejected('Not a project', path.extname(resolved) || 'no extension');
  }

  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new PathRejected('File not found', resolved);
  }
  if (!stats.isFile()) {
    throw new PathRejected('Not a file', resolved);
  }
  return resolved;
}

/** Vets an export destination. The file need not exist yet. */
export function resolveWritablePath(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathRejected('Invalid file path', 'path must be a non-empty string');
  }
  const resolved = path.resolve(candidate);
  if (!WRITABLE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new PathRejected('Unsupported export format', path.extname(resolved) || 'no extension');
  }

  let parent;
  try {
    parent = statSync(path.dirname(resolved));
  } catch {
    throw new PathRejected('Destination folder does not exist', path.dirname(resolved));
  }
  if (!parent.isDirectory()) {
    throw new PathRejected('Destination folder does not exist', path.dirname(resolved));
  }
  return resolved;
}
