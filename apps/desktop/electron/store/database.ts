import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import type { Adjustments, Preset, PresetCategory } from '@photoy/types';
import { NEUTRAL_ADJUSTMENTS, PRESET_CATEGORIES } from '@photoy/types';

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

/** A stored preset arrives as text, so every field is checked on the way out. */
function readAdjustments(text: string): Adjustments {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return NEUTRAL_ADJUSTMENTS;
    const result = { ...NEUTRAL_ADJUSTMENTS };
    for (const key of Object.keys(NEUTRAL_ADJUSTMENTS) as Array<keyof Adjustments>) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
    }
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

  recentFiles(): string[] {
    const rows = this.#db
      .prepare('SELECT path FROM recent_files ORDER BY opened_at DESC')
      .all() as Array<{ path: string }>;
    return rows.map((row) => row.path);
  }

  forgetFile(filePath: string): void {
    this.#db.prepare('DELETE FROM recent_files WHERE path = ?').run(filePath);
  }
}
