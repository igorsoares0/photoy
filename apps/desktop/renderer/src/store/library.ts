import { useMemo } from 'react';
import { create } from 'zustand';
import type {
  Adjustments,
  BatchItem,
  BatchRequest,
  ExportFormat,
  LibraryEntry,
  LibraryFolder,
  OutputSpace,
} from '@photoy/types';
import { NO_ENTRIES, filterEntries } from '../lib/library';

/**
 * Browsing a folder.
 *
 * A store of its own rather than part of the editor's, for one reason that
 * matters: a thumbnail arriving must not re-render the panel of twenty sliders
 * beside it. The two stores share nothing - the library holds paths, the editor
 * holds a document - and the only traffic between them is a path being opened.
 */

/** The size thumbnails are asked for. Two hundred and fifty-six at 2x. */
export const THUMBNAIL_SIDE = 256;

/**
 * How many thumbnails may be in flight at once.
 *
 * The engine has its own queue and its own memory budget, so this is not about
 * protecting it - it is about order. Asking for four hundred at once means the
 * four hundredth is as urgent as the first, and the tiles on screen finish last.
 */
const IN_FLIGHT_LIMIT = 6;

export interface BatchSettings {
  targetDirectory: string | null;
  format: ExportFormat;
  quality: number;
  colorSpace: OutputSpace;
  maxSide: number | null;
  /** Apply the adjustments from the open photograph, rather than none. */
  applyAdjustments: boolean;
}

export interface BatchState {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  /** What the last run produced, kept until the next one starts. */
  items: BatchItem[] | null;
  cancelled: boolean;
}

interface LibraryStore {
  folder: LibraryFolder | null;
  loading: boolean;
  error: string | null;
  recentFolders: string[];

  /** Object URLs for the thumbnails that have arrived. */
  thumbnails: Record<string, string>;
  /** Paths that failed, so a broken file is not asked for on every scroll. */
  unreadable: Record<string, true>;

  /** Filter by name, as typed. */
  query: string;
  onlyFavourites: boolean;
  /** Paths ticked for a batch. */
  selection: string[];

  batch: BatchState;
  settings: BatchSettings;

  chooseFolder(): Promise<void>;
  openFolder(path: string): Promise<void>;
  closeFolder(): void;
  loadRecentFolders(): Promise<void>;
  requestThumbnail(path: string): void;
  toggleFavourite(path: string): Promise<void>;
  setQuery(query: string): void;
  setOnlyFavourites(only: boolean): void;
  toggleSelected(path: string, extend: boolean): void;
  selectAll(): void;
  clearSelection(): void;
  updateSettings(patch: Partial<BatchSettings>): void;
  runBatch(adjustments: Adjustments | null, name: string): Promise<void>;
  cancelBatch(): Promise<void>;
  setProgress(done: number, total: number, current: string | null): void;
  dismissBatch(): void;
}

const IDLE_BATCH: BatchState = {
  running: false,
  done: 0,
  total: 0,
  current: null,
  items: null,
  cancelled: false,
};

export const useLibrary = create<LibraryStore>((set, get) => {
  /** Paths asked for and not yet answered, and paths still to ask about. */
  const inFlight = new Set<string>();
  const queue: string[] = [];

  const pump = () => {
    while (inFlight.size < IN_FLIGHT_LIMIT && queue.length > 0) {
      const path = queue.shift();
      if (path === undefined) break;
      if (get().thumbnails[path] !== undefined || get().unreadable[path] === true) continue;
      inFlight.add(path);
      void window.photoy
        .thumbnail(path, THUMBNAIL_SIDE)
        .then((answer) => {
          if (answer.ok) {
            const url = URL.createObjectURL(new Blob([answer.value.bytes], { type: 'image/jpeg' }));
            set((state) => ({ thumbnails: { ...state.thumbnails, [path]: url } }));
          } else {
            // Remembered rather than retried: a file the engine cannot read
            // will still be unreadable the next time the tile scrolls past.
            set((state) => ({ unreadable: { ...state.unreadable, [path]: true } }));
          }
        })
        .finally(() => {
          inFlight.delete(path);
          pump();
        });
    }
  };

  /** Frees the object URLs of a folder being left behind. */
  const release = () => {
    for (const url of Object.values(get().thumbnails)) URL.revokeObjectURL(url);
    queue.length = 0;
    inFlight.clear();
  };

  const adopt = (folder: LibraryFolder) => {
    release();
    set({
      folder,
      thumbnails: {},
      unreadable: {},
      selection: [],
      query: '',
      loading: false,
      error: null,
    });
  };

  return {
    folder: null,
    loading: false,
    error: null,
    recentFolders: [],
    thumbnails: {},
    unreadable: {},
    query: '',
    onlyFavourites: false,
    selection: [],
    batch: IDLE_BATCH,
    settings: {
      targetDirectory: null,
      format: 'jpeg',
      quality: 90,
      colorSpace: 'srgb',
      maxSide: null,
      applyAdjustments: true,
    },

    chooseFolder: async () => {
      set({ loading: true, error: null });
      const picked = await window.photoy.chooseFolder();
      if (!picked.ok) {
        set({ loading: false, error: picked.error.message });
        return;
      }
      if (picked.value === null) {
        set({ loading: false });
        return;
      }
      adopt(picked.value);
      void get().loadRecentFolders();
    },

    openFolder: async (path) => {
      set({ loading: true, error: null });
      const opened = await window.photoy.openFolder(path);
      if (!opened.ok) {
        set({ loading: false, error: opened.error.message });
        void get().loadRecentFolders();
        return;
      }
      adopt(opened.value);
      void get().loadRecentFolders();
    },

    closeFolder: () => {
      release();
      set({ folder: null, thumbnails: {}, unreadable: {}, selection: [], query: '' });
    },

    loadRecentFolders: async () => {
      const listed = await window.photoy.recentFolders();
      if (listed.ok) set({ recentFolders: listed.value });
    },

    requestThumbnail: (path) => {
      const state = get();
      if (state.thumbnails[path] !== undefined || state.unreadable[path] === true) return;
      if (inFlight.has(path) || queue.includes(path)) return;
      queue.push(path);
      pump();
    },

    toggleFavourite: async (path) => {
      const folder = get().folder;
      if (folder === null) return;
      const entry = folder.entries.find((candidate) => candidate.path === path);
      if (entry === undefined) return;
      const next = !entry.favourite;
      // Shown at once and confirmed after: marking is a judgement someone makes
      // at the speed of looking, and a star that waits for a database is a star
      // that gets clicked twice.
      set({
        folder: {
          ...folder,
          entries: folder.entries.map((candidate) =>
            candidate.path === path ? { ...candidate, favourite: next } : candidate,
          ),
        },
      });
      const saved = await window.photoy.setFavourite(path, next);
      if (!saved.ok) set({ error: saved.error.message });
    },

    setQuery: (query) => set({ query }),
    setOnlyFavourites: (onlyFavourites) => set({ onlyFavourites }),

    toggleSelected: (path, extend) =>
      set((state) => {
        if (!extend) return { selection: state.selection.includes(path) ? [] : [path] };
        return {
          selection: state.selection.includes(path)
            ? state.selection.filter((candidate) => candidate !== path)
            : [...state.selection, path],
        };
      }),

    // A one-off read rather than a subscription, so building a new array here
    // costs nothing: what must not churn is what a component renders from.
    selectAll: () =>
      set((state) => ({
        selection: filterEntries(state.folder?.entries ?? NO_ENTRIES, {
          query: state.query,
          onlyFavourites: state.onlyFavourites,
        }).map((entry) => entry.path),
      })),
    clearSelection: () => set({ selection: [] }),

    updateSettings: (patch) => set((state) => ({ settings: { ...state.settings, ...patch } })),

    runBatch: async (adjustments, name) => {
      const state = get();
      const directory = state.settings.targetDirectory;
      if (directory === null || state.selection.length === 0 || state.batch.running) return;

      const request: BatchRequest = {
        paths: state.selection,
        adjustments: state.settings.applyAdjustments ? adjustments : null,
        name,
        targetDirectory: directory,
        format: state.settings.format,
        quality: state.settings.quality,
        colorSpace: state.settings.colorSpace,
        maxSide: state.settings.maxSide,
        preserveMetadata: true,
      };
      set({
        batch: {
          running: true,
          done: 0,
          total: state.selection.length,
          current: null,
          items: null,
          cancelled: false,
        },
      });
      const answer = await window.photoy.runBatch(request);
      if (!answer.ok) {
        set({ batch: { ...IDLE_BATCH }, error: answer.error.message });
        return;
      }
      set({
        batch: {
          running: false,
          done: answer.value.items.length,
          total: answer.value.items.length,
          current: null,
          items: answer.value.items,
          cancelled: answer.value.cancelled,
        },
      });
    },

    cancelBatch: async () => {
      await window.photoy.cancelBatch();
    },

    setProgress: (done, total, current) =>
      set((state) =>
        state.batch.running ? { batch: { ...state.batch, done, total, current } } : {},
      ),

    dismissBatch: () => set({ batch: { ...IDLE_BATCH } }),
  };
});

/**
 * The entries the filters leave.
 *
 * A hook rather than a plain selector, and that is not a style choice: a
 * selector that filters builds a new array on every read, zustand compares
 * results by identity, and the renderer loops until React gives up. This
 * codebase has been caught by that three times. The three inputs are subscribed
 * to separately - two of them primitives, and the third a reference that only
 * changes when the folder does - and the filtering happens in a memo.
 */
export function useVisibleEntries(): readonly LibraryEntry[] {
  const entries = useLibrary((state) => state.folder?.entries ?? NO_ENTRIES);
  const query = useLibrary((state) => state.query);
  const onlyFavourites = useLibrary((state) => state.onlyFavourites);
  return useMemo(
    () => filterEntries(entries, { query, onlyFavourites }),
    [entries, query, onlyFavourites],
  );
}
