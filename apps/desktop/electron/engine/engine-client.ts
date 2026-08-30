import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  MAX_HEADER_BYTES,
  MAX_PAYLOAD_BYTES,
  type EngineFrameHeader,
  type EngineState,
  type ResponseHeader,
} from '@photoy/ipc';

export interface EngineResponse {
  header: ResponseHeader;
  payload: Buffer;
}

/** Raised when the engine answers with ok: false. */
export class EngineCallError extends Error {
  readonly code: string;
  readonly detail?: string;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'EngineCallError';
    this.code = code;
    this.detail = detail;
  }
}

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * Owns the native engine child process and speaks its frame protocol.
 *
 * Lives in the main process only. The renderer reaches it through the typed
 * IPC surface, never directly, so the engine's stdio never becomes a hole in
 * the sandbox.
 */
export class EngineClient extends EventEmitter {
  #executablePath: string;
  #child: ChildProcessWithoutNullStreams | null = null;
  /**
   * Incoming bytes, kept as arrived.
   *
   * Concatenating on every chunk would copy the whole accumulation each time,
   * which is quadratic in the payload: an 8 MB preview arrives as a hundred-odd
   * pipe reads and would cost hundreds of megabytes of copying. Chunks are
   * joined only once enough bytes are present for the next thing to parse.
   */
  #chunks: Buffer[] = [];
  #buffered = 0;
  /** Bytes required before there is any point looking at the stream again. */
  #need = 8;
  #pending = new Map<
    number,
    { resolve: (value: EngineResponse) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
  >();
  #nextId = 1;
  #state: EngineState = 'stopped';
  /** Set while stop() is running so the exit handler does not restart it. */
  #stopping = false;

  constructor(executablePath: string) {
    super();
    this.#executablePath = executablePath;
  }

  get state(): EngineState {
    return this.#state;
  }

  #setState(state: EngineState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit('state', state);
  }

  start(): void {
    if (this.#child !== null) return;
    this.#setState('starting');

    const child = spawn(this.#executablePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;

    child.stdout.on('data', (chunk: Buffer) => this.#consume(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.on('spawn', () => this.#setState('ready'));
    child.on('error', (error) => {
      this.#failAllPending(new Error(`engine could not start: ${error.message}`));
      this.#child = null;
      this.#setState('failed');
    });
    child.on('exit', (code, signal) => {
      this.#child = null;
      this.#chunks = [];
      this.#buffered = 0;
      this.#need = 8;
      this.#failAllPending(
        new Error(`engine exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`),
      );
      this.#setState(this.#stopping ? 'stopped' : 'failed');
    });
  }

  async stop(): Promise<void> {
    const child = this.#child;
    if (child === null) {
      this.#setState('stopped');
      return;
    }
    this.#stopping = true;
    // Closing stdin ends the engine's read loop, which is its clean shutdown
    // path; the kill below is only a backstop for a wedged process.
    child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.#stopping = false;
  }

  /** Restarts a crashed engine. Open documents do not survive: they were held
   * in the dead process, and pretending otherwise would be a lie to the UI. */
  restart(): void {
    this.#child = null;
    this.start();
  }

  #failAllPending(error: Error): void {
    for (const { reject, timer } of this.#pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.#pending.clear();
  }

  /** Joins the pending chunks into one buffer, keeping it for the next look. */
  #coalesce(): Buffer {
    if (this.#chunks.length > 1) {
      this.#chunks = [Buffer.concat(this.#chunks, this.#buffered)];
    }
    return this.#chunks[0] ?? Buffer.alloc(0);
  }

  #consume(chunk: Buffer): void {
    this.#chunks.push(chunk);
    this.#buffered += chunk.length;

    for (;;) {
      if (this.#buffered < this.#need) return;

      let buffer = this.#coalesce();
      const headerLength = buffer.readUInt32LE(0);
      if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
        this.#abortStream(`header length ${headerLength} is out of range`);
        return;
      }
      if (this.#buffered < 4 + headerLength + 4) {
        this.#need = 4 + headerLength + 4;
        return;
      }

      buffer = this.#coalesce();
      const payloadLength = buffer.readUInt32LE(4 + headerLength);
      if (payloadLength > MAX_PAYLOAD_BYTES) {
        this.#abortStream(`payload length ${payloadLength} is out of range`);
        return;
      }
      const total = 4 + headerLength + 4 + payloadLength;
      if (this.#buffered < total) {
        this.#need = total;
        return;
      }

      buffer = this.#coalesce();
      const headerText = buffer.toString('utf8', 4, 4 + headerLength);
      // Copy rather than subarray: the payload outlives this buffer, and a view
      // would pin the whole accumulation in memory.
      const payload = Buffer.from(buffer.subarray(4 + headerLength + 4, total));
      this.#chunks = total < buffer.length ? [buffer.subarray(total)] : [];
      this.#buffered -= total;
      this.#need = 8;

      let parsed: EngineFrameHeader;
      try {
        parsed = JSON.parse(headerText) as EngineFrameHeader;
      } catch {
        this.#abortStream('response header is not valid JSON');
        return;
      }

      // Events are unsolicited and carry no id, so they never settle a request.
      if (parsed.type === 'event') {
        this.emit('event', parsed.event, parsed.data);
        continue;
      }

      const header = parsed as ResponseHeader;
      const pending = this.#pending.get(header.id);
      if (pending === undefined) continue;
      this.#pending.delete(header.id);
      clearTimeout(pending.timer);
      pending.resolve({ header, payload });
    }
  }

  /** A desynchronised stream cannot be recovered, so drop the process. */
  #abortStream(reason: string): void {
    this.#failAllPending(new Error(`engine protocol error: ${reason}`));
    this.#child?.kill();
    this.#child = null;
    this.#chunks = [];
    this.#buffered = 0;
    this.#need = 8;
    this.#setState('failed');
  }

  request(method: string, params?: unknown, coalesceKey?: string): Promise<EngineResponse> {
    const child = this.#child;
    if (child === null) {
      return Promise.reject(new EngineCallError('engine_unavailable', 'The engine is not running'));
    }

    const id = this.#nextId++;
    const header = Buffer.from(
      JSON.stringify({ type: 'request', id, method, params, coalesceKey }),
      'utf8',
    );
    const frame = Buffer.alloc(4 + header.length + 4);
    frame.writeUInt32LE(header.length, 0);
    header.copy(frame, 4);
    frame.writeUInt32LE(0, 4 + header.length);

    return new Promise<EngineResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new EngineCallError('internal_error', 'The engine did not answer', method));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer });
      child.stdin.write(frame);
    });
  }

  /** Unwraps a successful result, throwing EngineCallError otherwise. */
  async call<T>(
    method: string,
    params?: unknown,
    coalesceKey?: string,
  ): Promise<{ result: T; payload: Buffer }> {
    const { header, payload } = await this.request(method, params, coalesceKey);
    if (header.ok !== true) {
      const error = header.error ?? { code: 'internal_error', message: 'Unknown engine error' };
      throw new EngineCallError(error.code, error.message, error.detail);
    }
    return { result: header.result as T, payload };
  }
}
