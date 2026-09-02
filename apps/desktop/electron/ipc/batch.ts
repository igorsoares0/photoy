import path from 'node:path';
import type { BatchItem, BatchRequest, BatchResult, DocumentInfo, Operation } from '@photoy/types';
import { batchTarget } from './paths.ts';

/**
 * As much of the engine as a batch needs.
 *
 * Narrow on purpose: the loop below is the part that decides what happens to
 * two hundred of somebody's photographs, and it is worth being able to run it
 * against the real engine in a test without an Electron window around it.
 */
export interface BatchEngine {
  call<T>(method: string, params: unknown): Promise<{ result: T }>;
}

export interface BatchHooks {
  /** Called before each file, with how many are already done. */
  report(done: number, total: number, current: string | null): void;
  /** Asked before each file. True stops the run after the ones already written. */
  cancelled(): boolean;
  /**
   * Vets a path from the caller.
   *
   * Passed in rather than imported so that the same loop serves the untrusted
   * case - paths chosen in the renderer - and the test, which has its own.
   */
  resolve(candidate: string): string;
}

/**
 * Applies one look to many photographs and writes them out.
 *
 * Each file is opened, adjusted, exported and closed on its own. That is what
 * keeps a batch from touching the document somebody is editing, and what keeps
 * the memory cost flat: one photograph at a time, however long the list is.
 */
export async function runBatch(
  engine: BatchEngine,
  request: BatchRequest,
  hooks: BatchHooks,
): Promise<BatchResult> {
  const started = Date.now();
  const items: BatchItem[] = [];

  for (const [index, candidate] of request.paths.entries()) {
    if (hooks.cancelled()) {
      items.push({ path: candidate, outcome: 'cancelled', target: null, error: null });
      continue;
    }
    hooks.report(index, request.paths.length, candidate);

    let documentId: string | null = null;
    try {
      const filePath = hooks.resolve(candidate);
      const target = batchTarget(filePath, request.targetDirectory, request.format);
      if (path.resolve(target) === path.resolve(filePath)) {
        // Writing a JPEG over the JPEG it was made from would destroy the
        // original, which is the one thing a non-destructive editor may never
        // do - and in a batch it would do it two hundred times before anyone
        // noticed.
        throw new Error('o destino é o próprio arquivo de origem');
      }

      const opened = await engine.call<DocumentInfo>('image.open', { path: filePath });
      documentId = opened.result.id;

      const operations: Operation[] = [];
      if (request.adjustments !== null) {
        operations.push({
          kind: 'adjust',
          adjustments: request.adjustments,
          name: request.name,
        } as Operation);
      }
      if (request.maxSide !== null) {
        const { width, height } = opened.result.image;
        const scale = request.maxSide / Math.max(width, height);
        // Only ever down. A batch that enlarged everything to reach a number
        // would be inventing detail on every photograph that was already small.
        if (scale < 1) {
          operations.push({
            kind: 'resize',
            width: Math.max(1, Math.round(width * scale)),
            height: Math.max(1, Math.round(height * scale)),
          } as Operation);
        }
      }
      for (const operation of operations) {
        await engine.call('edit.apply', { documentId, operation });
      }

      await engine.call('image.export', {
        documentId,
        path: target,
        format: request.format,
        quality: request.quality,
        colorSpace: request.colorSpace,
        preserveMetadata: request.preserveMetadata,
      });
      items.push({ path: filePath, outcome: 'exported', target, error: null });
    } catch (error) {
      items.push({
        path: candidate,
        outcome: 'failed',
        target: null,
        // One failure does not stop the run. A batch of two hundred that aborts
        // on the one file with a broken header has done nothing useful; one
        // that skips it and says so has done a hundred and ninety-nine.
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (documentId !== null) {
        await engine.call('image.close', { documentId }).catch(() => undefined);
      }
    }
  }

  hooks.report(request.paths.length, request.paths.length, null);
  return {
    items,
    exported: items.filter((item) => item.outcome === 'exported').length,
    failed: items.filter((item) => item.outcome === 'failed').length,
    cancelled: items.some((item) => item.outcome === 'cancelled'),
    durationMs: Date.now() - started,
  };
}
