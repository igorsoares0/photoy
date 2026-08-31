import type {
  DocumentInfo,
  EditHistory,
  ExportRequest,
  ExportResult,
  Operation,
  PreviewInfo,
  PreviewRequest,
} from '@photoy/types';

/** Reported by `engine.describe` so the host can refuse a mismatched binary. */
export interface EngineDescription {
  name: string;
  version: string;
  protocolVersion: number;
  /** Formats the build can decode, from the codecs actually linked in. */
  decodeFormats: string[];
  /** Formats the build can encode. */
  encodeFormats: string[];
  /** Colour spaces an export can be written in. */
  outputSpaces: string[];
  /** Edit operations the stack understands. */
  operations: string[];
  /** Locally installed models, with the licence each one ships under. */
  models: Array<{
    id: string;
    file: string;
    license: string;
    source: string;
    available: boolean;
    byteLength: number;
    loaded: boolean;
  }>;
  /** How many jobs the engine will run at once. */
  workers: number;
  /** Identifier of the space the engine edits in. */
  workingSpace: string;
}

/**
 * The engine surface. Kept deliberately small: every entry is a boundary the
 * renderer can reach, so each one has to earn its place.
 */
export interface EngineMethods {
  'engine.describe': { params: void; result: EngineDescription };
  'image.open': { params: { path: string }; result: DocumentInfo };
  'image.close': { params: { documentId: string }; result: { closed: boolean } };
  /** Result metadata arrives in the header; pixels arrive as the frame payload. */
  'image.renderPreview': { params: PreviewRequest; result: PreviewInfo };
  'image.export': { params: ExportRequest; result: ExportResult };

  'edit.apply': {
    params: { documentId: string; operation: Operation; replaceTop?: boolean };
    result: EditHistory;
  };
  'edit.undo': { params: { documentId: string }; result: EditHistory };
  'edit.redo': { params: { documentId: string }; result: EditHistory };
  'edit.seek': { params: { documentId: string; cursor: number }; result: EditHistory };
  'edit.reset': { params: { documentId: string }; result: EditHistory };
  'edit.history': { params: { documentId: string }; result: EditHistory };

  'ai.segment': {
    params: { documentId: string };
    result: { documentId: string; raster: number; width: number; height: number };
  };

  'job.cancel': { params: { jobId: number }; result: { cancelled: boolean } };
}

export type EngineMethodName = keyof EngineMethods;

export const PROTOCOL_VERSION = 1;
