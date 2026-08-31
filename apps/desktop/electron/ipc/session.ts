import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectState, RecoveryOffer } from '@photoy/ipc';

/**
 * What is open and whether it has been saved.
 *
 * Lives in the main process because that is where the autosave timer lives, and
 * a timer that has to ask the renderer what to save would stop working exactly
 * when it is needed - during a crash.
 */
export class Session {
  documentId: string | null = null;
  fileName = '';
  path: string | null = null;
  dirty = false;

  open(documentId: string, fileName: string, projectPath: string | null): void {
    this.documentId = documentId;
    this.fileName = fileName;
    this.path = projectPath;
    this.dirty = false;
  }

  close(): void {
    this.documentId = null;
    this.path = null;
    this.dirty = false;
  }

  state(): ProjectState {
    return { path: this.path, dirty: this.dirty };
  }
}

/**
 * The unfinished session left behind by a run that did not end cleanly.
 *
 * Written beside the application's own data, never over the user's project: an
 * autosave that overwrote the file being edited would turn a crash into data
 * loss instead of preventing one.
 */
export class Recovery {
  readonly directory: string;
  readonly projectPath: string;
  readonly markerPath: string;

  constructor() {
    this.directory = path.join(app.getPath('userData'), 'recovery');
    this.projectPath = path.join(this.directory, 'session.myphoto');
    this.markerPath = path.join(this.directory, 'session.json');
  }

  prepare(): void {
    mkdirSync(this.directory, { recursive: true });
  }

  /// Records what the autosaved project belongs to.
  mark(fileName: string, projectPath: string | null): void {
    writeFileSync(
      this.markerPath,
      JSON.stringify({ fileName, projectPath, savedAt: Date.now() }, null, 2),
      'utf8',
    );
  }

  /** What to offer on startup, or null when the last run ended cleanly. */
  offer(): RecoveryOffer | null {
    if (!existsSync(this.projectPath) || !existsSync(this.markerPath)) return null;
    try {
      const marker = JSON.parse(readFileSync(this.markerPath, 'utf8')) as {
        fileName?: string;
        savedAt?: number;
      };
      return {
        fileName: marker.fileName ?? 'sem nome',
        savedAt: marker.savedAt ?? statSync(this.projectPath).mtimeMs,
      };
    } catch {
      return null;
    }
  }

  clear(): void {
    rmSync(this.projectPath, { force: true });
    rmSync(this.markerPath, { force: true });
  }
}
