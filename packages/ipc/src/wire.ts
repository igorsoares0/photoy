/**
 * Wire protocol between the Electron main process and the native engine.
 *
 * The engine is a child process, not an in-process addon, so it stays free of
 * Electron's ABI, can be exercised from a terminal, and cannot take the window
 * down when it crashes.
 *
 * Every message is one frame on stdin/stdout:
 *
 *   uint32le headerLength
 *   headerLength bytes  UTF-8 JSON header
 *   uint32le payloadLength
 *   payloadLength bytes raw payload (pixels; empty for most messages)
 *
 * Keeping pixels out of the JSON is what lets a preview cross the boundary
 * without being base64-encoded on both ends.
 */

export const FRAME_LENGTH_BYTES = 4;

/** Guard against a desynchronised stream claiming an absurd allocation. */
export const MAX_HEADER_BYTES = 1 << 20; // 1 MiB
export const MAX_PAYLOAD_BYTES = 1 << 30; // 1 GiB

export interface RequestHeader {
  type: 'request';
  /**
   * Monotonic per-connection id. Responses echo it back, and it doubles as the
   * job id: there is no separate submit-then-poll handshake.
   */
  id: number;
  method: string;
  params?: unknown;
  /**
   * Supersession key. Submitting under a key the engine is already working on
   * cancels the earlier job, which is what turns a dragged control into one
   * render rather than one per frame.
   */
  coalesceKey?: string;
}

export interface ResponseHeader {
  type: 'response';
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; detail?: string };
}

export interface EventHeader {
  type: 'event';
  event: string;
  data?: unknown;
}

export type EngineFrameHeader = RequestHeader | ResponseHeader | EventHeader;
