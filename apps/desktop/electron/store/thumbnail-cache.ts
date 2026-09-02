import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Thumbnails on disk, so a folder is slow once and instant afterwards.
 *
 * The spec asks for a cache that can be deleted without losing anything, and
 * this is the shape that makes that true: every entry is derivable from the
 * photograph it came from, nothing here is the only copy of anything, and the
 * directory can be removed between runs with no effect but a slow first scroll.
 *
 * Not in SQLite. A thumbnail is fifteen kilobytes of JPEG, and a thousand of
 * them in a database file is a database file that has to be vacuumed, backed up
 * and locked; as files they are what the operating system is already good at.
 */
export class ThumbnailCache {
  readonly #directory: string;
  /** Bytes written since the last prune, so pruning is not a per-write walk. */
  #writtenSincePrune = 0;

  constructor(directory: string) {
    this.#directory = path.join(directory, 'thumbnails');
    mkdirSync(this.#directory, { recursive: true });
  }

  /**
   * The name a thumbnail of this file would have.
   *
   * Size and modification time are in the key, so a photograph edited outside
   * the application is thumbnailed again rather than shown as it used to be.
   * The path is in it too, because two different files can share both.
   */
  #keyFor(filePath: string, maxSide: number): string | null {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return null;
    }
    const digest = createHash('sha1')
      .update(`${filePath}|${stat.size}|${Math.round(stat.mtimeMs)}|${maxSide}`)
      .digest('hex');
    return path.join(this.#directory, `${digest}.jpg`);
  }

  /** The stored thumbnail, or null when there is none for this exact file. */
  read(filePath: string, maxSide: number): Buffer | null {
    const key = this.#keyFor(filePath, maxSide);
    if (key === null) return null;
    try {
      const bytes = readFileSync(key);
      // Touched on read so the prune below evicts what nobody looks at rather
      // than what was written longest ago - a folder revisited every day should
      // not lose its thumbnails to one visit to a folder of ten thousand.
      const now = new Date();
      try {
        utimesSync(key, now, now);
      } catch {
        // A read-only cache still serves reads; only the eviction order suffers.
      }
      return bytes;
    } catch {
      return null;
    }
  }

  write(filePath: string, maxSide: number, bytes: Buffer): void {
    const key = this.#keyFor(filePath, maxSide);
    if (key === null) return;
    try {
      // Through a temp file: two windows browsing the same folder will race,
      // and a half-written JPEG that looks complete is worse than a miss.
      const temporary = `${key}.${process.pid}.tmp`;
      writeFileSync(temporary, bytes);
      renameSync(temporary, key);
      this.#writtenSincePrune += bytes.byteLength;
      if (this.#writtenSincePrune > PRUNE_INTERVAL_BYTES) this.prune();
    } catch {
      // A cache that cannot be written is a cache that is slow, not an error
      // the person browsing a folder should have to read about.
    }
  }

  /**
   * Drops the least recently used entries until the budget is met.
   *
   * Runs on a byte budget rather than a count because that is what the user's
   * disk cares about, and the sizes differ by an order of magnitude between a
   * flat sky and a forest.
   */
  prune(budgetBytes = BUDGET_BYTES): void {
    this.#writtenSincePrune = 0;
    let entries: Array<{ file: string; size: number; used: number }>;
    try {
      entries = readdirSync(this.#directory)
        .filter((name) => name.endsWith('.jpg'))
        .map((name) => {
          const file = path.join(this.#directory, name);
          const stat = statSync(file);
          return { file, size: stat.size, used: stat.atimeMs || stat.mtimeMs };
        });
    } catch {
      return;
    }

    let total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total <= budgetBytes) return;

    entries.sort((a, b) => a.used - b.used);
    for (const entry of entries) {
      if (total <= budgetBytes) break;
      try {
        rmSync(entry.file, { force: true });
        total -= entry.size;
      } catch {
        // Held open by something else; it will be a candidate again next time.
      }
    }
  }

  /** Everything, for a person who wants the disk back. */
  clear(): void {
    rmSync(this.#directory, { recursive: true, force: true });
    mkdirSync(this.#directory, { recursive: true });
    this.#writtenSincePrune = 0;
  }
}

/**
 * How much disk the thumbnails may take.
 *
 * Two hundred and fifty-six megabytes is roughly seventeen thousand thumbnails
 * at the sizes measured here, which is more photographs than the V1's simple
 * organisation is meant to hold - so in practice the budget is a guard against
 * a runaway rather than a limit anyone meets.
 */
const BUDGET_BYTES = 256 * 1024 * 1024;

/** How much may be written between two prunes. */
const PRUNE_INTERVAL_BYTES = 16 * 1024 * 1024;
