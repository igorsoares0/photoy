import path from 'node:path';
import { statSync } from 'node:fs';

/** Extensions the engine can decode. Content is still sniffed on open. */
const READABLE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.jpe', '.png', '.tif', '.tiff', '.webp']);

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
