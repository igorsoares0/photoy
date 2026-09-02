import { BrowserWindow, dialog } from 'electron';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { BatchRequest, BatchResult, LibraryFolder } from '@photoy/types';
import { Events } from '@photoy/ipc';
import type { EngineClient } from '../engine/engine-client.js';
import type { Database } from '../store/database.js';
import type { ThumbnailCache } from '../store/thumbnail-cache.js';
import { PathRejected, hasReadableExtension, listFolder, resolveFolderPath } from './paths.js';
import { runBatch } from './batch.js';

export interface LibrarySurface {
  chooseFolder(): Promise<LibraryFolder | null>;
  openFolder(candidate: string): Promise<LibraryFolder>;
  recentFolders(): string[];
  thumbnail(
    candidate: string,
    maxSide: number,
  ): Promise<{ bytes: Buffer; cached: boolean; width: number; height: number }>;
  favourite(candidate: string, on: boolean): string[];
  favourites(): string[];
  chooseDirectory(): Promise<string | null>;
  runBatch(request: BatchRequest): Promise<BatchResult>;
  cancelBatch(): void;
}

/**
 * Browsing, marking and batch work.
 *
 * Kept out of the main handler file because none of it touches the open
 * document: a batch runs on files, opening and closing each one behind the
 * session rather than through it, which is what lets it run while somebody is
 * editing something else.
 */
export function createLibrary(
  engine: EngineClient,
  database: Database,
  cache: ThumbnailCache,
): LibrarySurface {
  /** Set while a batch is running, so the next file can be told to stop. */
  let cancelling = false;
  let running = false;

  const withFavourites = (folderPath: string): LibraryFolder => {
    const listed = listFolder(folderPath, new Set());
    const marked = new Set(database.favouritesAmong(listed.entries.map((entry) => entry.path)));
    return {
      ...listed,
      entries: listed.entries.map((entry) => ({ ...entry, favourite: marked.has(entry.path) })),
    };
  };

  const pickFolder = async (title: string): Promise<string | null> => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = { title, properties: ['openDirectory' as const] };
    const picked = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return resolveFolderPath(picked.filePaths[0]);
  };

  const openFolder = async (candidate: string): Promise<LibraryFolder> => {
    const folderPath = resolveFolderPath(candidate);
    database.rememberFolder(folderPath);
    return withFavourites(folderPath);
  };

  const report = (done: number, total: number, current: string | null) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send(Events.batchProgress, {
      done,
      total,
      current,
    });
  };

  return {
    chooseFolder: async () => {
      const folderPath = await pickFolder('Abrir pasta');
      return folderPath === null ? null : openFolder(folderPath);
    },

    openFolder,

    recentFolders: () => database.recentFolders(),

    thumbnail: async (candidate: string, maxSide: number) => {
      const filePath = resolveFolderEntry(candidate);
      const stored = cache.read(filePath, maxSide);
      if (stored !== null) return { bytes: stored, cached: true, ...sizesOf(stored) };

      const { result, payload } = await engine.call<{ width: number; height: number }>(
        'image.thumbnail',
        { path: filePath, maxSide },
        `thumbnail:${filePath}`,
      );
      cache.write(filePath, maxSide, payload);
      return { bytes: payload, cached: false, width: result.width, height: result.height };
    },

    favourite: (candidate: string, on: boolean) => {
      database.setFavourite(resolveFolderEntry(candidate), on);
      return database.favourites();
    },

    favourites: () => database.favourites(),

    chooseDirectory: () => pickFolder('Pasta de destino'),

    runBatch: async (request: BatchRequest): Promise<BatchResult> => {
      if (running) {
        throw new PathRejected('A batch is already running', 'one at a time');
      }
      running = true;
      cancelling = false;
      try {
        return await runBatch(
          engine,
          { ...request, targetDirectory: resolveFolderPath(request.targetDirectory) },
          {
            report,
            cancelled: () => cancelling,
            resolve: resolveFolderEntry,
          },
        );
      } finally {
        running = false;
      }
    },

    cancelBatch: () => {
      cancelling = true;
    },
  };
}

/**
 * Vets a path that came out of a listing.
 *
 * The same rule the open dialog applies, and applied again rather than trusted:
 * the renderer holds the listing, and what comes back from it is a string like
 * any other string the renderer can send.
 */
function resolveFolderEntry(candidate: unknown): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new PathRejected('Invalid file path', 'path must be a non-empty string');
  }
  const resolved = path.resolve(candidate);
  if (!hasReadableExtension(resolved)) {
    throw new PathRejected('Unsupported file type', path.extname(resolved) || 'no extension');
  }
  let stats;
  try {
    stats = statSync(resolved);
  } catch {
    throw new PathRejected('File not found', resolved);
  }
  if (!stats.isFile()) throw new PathRejected('Not a file', resolved);
  return resolved;
}

/**
 * The dimensions in a JPEG's own header.
 *
 * A cached thumbnail is bytes and nothing else, and the grid needs its shape to
 * reserve the tile. Reading the frame header is a walk over a few hundred bytes
 * of markers, against decoding fifteen kilobytes of entropy-coded data.
 */
function sizesOf(jpeg: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) break;
    const marker = jpeg[offset + 1] ?? 0;
    const length = jpeg.readUInt16BE(offset + 2);
    // The SOF markers, which carry the frame size. C4, C8 and CC are not frames
    // - they are the Huffman and arithmetic tables that share the range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: jpeg.readUInt16BE(offset + 5),
        width: jpeg.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return { width: 0, height: 0 };
}
