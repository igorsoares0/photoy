import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type {
  Adjustments,
  Curve,
  CurveChannel,
  CurvePoint,
  Curves,
  Preset,
  PresetCategory,
} from '@photoy/types';
import { IDENTITY_CURVES, NEUTRAL_ADJUSTMENTS, PRESET_CATEGORIES } from '@photoy/types';

/**
 * The application's own structured data: presets, recent files, settings.
 *
 * SQLite because the spec asks for it, and `node:sqlite` because Electron 44
 * carries Node 24, which has it built in. A native module would have to be
 * rebuilt against Electron's ABI on every upgrade, which is exactly the trade
 * this project avoided when it chose a sidecar over an addon.
 *
 * Nothing large lives here. A preset is a handful of numbers, a recent file is
 * a path; the pixels stay in the engine and in the project container.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS presets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  adjustments TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recent_files (
  path      TEXT PRIMARY KEY,
  opened_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recent_files_opened ON recent_files (opened_at DESC);
CREATE TABLE IF NOT EXISTS favourites (
  path     TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS recent_folders (
  path      TEXT PRIMARY KEY,
  opened_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS recent_folders_opened ON recent_folders (opened_at DESC);
CREATE TABLE IF NOT EXISTS projects (
  source_path  TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  saved_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** How many recent files are remembered. Beyond this nobody is scrolling. */
const RECENT_LIMIT = 20;

function asCategory(value: string): PresetCategory {
  return (PRESET_CATEGORIES as readonly string[]).includes(value)
    ? (value as PresetCategory)
    : 'colour';
}

/**
 * The four curves out of a stored preset.
 *
 * Only the shape is checked here, not the spacing or the ordering: the engine
 * sanitises every curve it is given, so a preset saved by an older build - or
 * edited by hand - is cleaned when it is applied rather than twice.
 */
function readCurves(value: unknown): Curves {
  if (value === null || typeof value !== 'object') return IDENTITY_CURVES;
  const stored = value as Record<string, unknown>;
  const channel = (name: CurveChannel): Curve => {
    const points = stored[name];
    if (!Array.isArray(points)) return [];
    return points
      .filter(
        (point): point is CurvePoint =>
          point !== null &&
          typeof point === 'object' &&
          Number.isFinite((point as CurvePoint).x) &&
          Number.isFinite((point as CurvePoint).y),
      )
      .map((point) => ({ x: point.x, y: point.y }));
  };
  return {
    rgb: channel('rgb'),
    red: channel('red'),
    green: channel('green'),
    blue: channel('blue'),
  };
}

/** A stored preset arrives as text, so every field is checked on the way out. */
function readAdjustments(text: string): Adjustments {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return NEUTRAL_ADJUSTMENTS;
    const stored = parsed as Record<string, unknown>;
    const result = { ...NEUTRAL_ADJUSTMENTS };
    for (const key of Object.keys(NEUTRAL_ADJUSTMENTS) as Array<keyof Adjustments>) {
      const value = stored[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
    result.curves = readCurves(stored.curves);
    return result;
  } catch {
    // A preset that cannot be read is a preset that does nothing, which is
    // better than a preset that throws while the panel is being drawn.
    return NEUTRAL_ADJUSTMENTS;
  }
}

export class Database {
  readonly #db: DatabaseSync;

  constructor(directory: string) {
    this.#db = new DatabaseSync(path.join(directory, 'photoy.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(SCHEMA);
  }

  close(): void {
    this.#db.close();
  }

  listPresets(): Preset[] {
    const rows = this.#db
      .prepare('SELECT id, name, category, adjustments FROM presets ORDER BY updated_at DESC')
      .all() as Array<{ id: string; name: string; category: string; adjustments: string }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: asCategory(row.category),
      adjustments: readAdjustments(row.adjustments),
      builtIn: false,
    }));
  }

  savePreset(preset: Omit<Preset, 'builtIn'>): void {
    const now = Date.now();
    this.#db
      .prepare(
        `INSERT INTO presets (id, name, category, adjustments, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           category = excluded.category,
           adjustments = excluded.adjustments,
           updated_at = excluded.updated_at`,
      )
      .run(
        preset.id,
        preset.name,
        preset.category,
        JSON.stringify(preset.adjustments),
        now,
        now,
      );
  }

  deletePreset(id: string): void {
    this.#db.prepare('DELETE FROM presets WHERE id = ?').run(id);
  }

  /** Records an opened file, keeping the list to its limit. */
  rememberFile(filePath: string): void {
    this.#db
      .prepare(
        `INSERT INTO recent_files (path, opened_at) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at`,
      )
      .run(filePath, Date.now());
    this.#db
      .prepare(
        `DELETE FROM recent_files WHERE path NOT IN
           (SELECT path FROM recent_files ORDER BY opened_at DESC LIMIT ?)`,
      )
      .run(RECENT_LIMIT);
  }

  /**
   * Records that a photograph has a project saved from it.
   *
   * The point is the recent list: once the work exists, offering the untouched
   * photograph instead of it is offering to throw the work away.
   */
  rememberProject(sourcePath: string, projectPath: string): void {
    this.#db
      .prepare(
        `INSERT INTO projects (source_path, project_path, saved_at) VALUES (?, ?, ?)
         ON CONFLICT(source_path) DO UPDATE SET
           project_path = excluded.project_path,
           saved_at = excluded.saved_at`,
      )
      .run(sourcePath, projectPath, Date.now());
  }

  /** The project saved from a photograph, if there is one. */
  projectFor(sourcePath: string): string | null {
    const row = this.#db
      .prepare('SELECT project_path FROM projects WHERE source_path = ?')
      .get(sourcePath) as { project_path: string } | undefined;
    return row?.project_path ?? null;
  }

  recentFiles(): string[] {
    const rows = this.#db
      .prepare('SELECT path FROM recent_files ORDER BY opened_at DESC')
      .all() as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  forgetFile(filePath: string): void {
    this.#db.prepare('DELETE FROM recent_files WHERE path = ?').run(filePath);
  }

  /**
   * Marks a photograph, or unmarks it.
   *
   * Keyed by path rather than by any identifier of our own, because there is no
   * catalogue here: the folder on disk is the truth, and a favourite is a note
   * about a file that exists in it. Moving the file loses the mark, which is
   * the honest outcome for a program that never claimed to own the file.
   */
  setFavourite(filePath: string, favourite: boolean): void {
    if (favourite) {
      this.#db
        .prepare(
          `INSERT INTO favourites (path, added_at) VALUES (?, ?)
           ON CONFLICT(path) DO NOTHING`,
        )
        .run(filePath, Date.now());
    } else {
      this.#db.prepare('DELETE FROM favourites WHERE path = ?').run(filePath);
    }
  }

  /** Every marked path, newest first. */
  favourites(): string[] {
    const rows = this.#db
      .prepare('SELECT path FROM favourites ORDER BY added_at DESC')
      .all() as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  /** Which of these paths are marked, as a set the caller can ask cheaply. */
  favouritesAmong(paths: readonly string[]): string[] {
    if (paths.length === 0) return [];
    const slots = paths.map(() => '?').join(', ');
    const rows = this.#db
      .prepare(`SELECT path FROM favourites WHERE path IN (${slots})`)
      .all(...paths) as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  rememberFolder(folderPath: string): void {
    this.#db
      .prepare(
        `INSERT INTO recent_folders (path, opened_at) VALUES (?, ?)
         ON CONFLICT(path) DO UPDATE SET opened_at = excluded.opened_at`,
      )
      .run(folderPath, Date.now());
    this.#db
      .prepare(
        `DELETE FROM recent_folders WHERE path NOT IN
           (SELECT path FROM recent_folders ORDER BY opened_at DESC LIMIT ?)`,
      )
      .run(RECENT_LIMIT);
  }

  recentFolders(): string[] {
    const rows = this.#db
      .prepare('SELECT path FROM recent_folders ORDER BY opened_at DESC')
      .all() as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  forgetFolder(folderPath: string): void {
    this.#db.prepare('DELETE FROM recent_folders WHERE path = ?').run(folderPath);
  }
}
