/**
 * Engine error codes. The UI maps these to copy that states what happened,
 * what is still intact, and what to do next.
 */
export type EngineErrorCode =
  | 'engine_unavailable'
  | 'invalid_request'
  | 'file_not_found'
  | 'file_unreadable'
  | 'unsupported_format'
  | 'decode_failed'
  | 'encode_failed'
  | 'write_failed'
  | 'document_not_found'
  | 'out_of_memory'
  | 'cancelled'
  | 'internal_error';

export interface EngineError {
  code: EngineErrorCode;
  /** Human-readable summary. */
  message: string;
  /** Technical note rendered in monospace next to the message. */
  detail?: string;
}

export class EngineFailure extends Error {
  readonly code: EngineErrorCode;
  readonly detail?: string;

  constructor(error: EngineError) {
    super(error.message);
    this.name = 'EngineFailure';
    this.code = error.code;
    this.detail = error.detail;
  }
}
