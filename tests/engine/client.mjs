import { spawn } from 'node:child_process';

/**
 * Minimal host-side client for the engine's frame protocol.
 *
 * Kept independent of the Electron implementation on purpose: if both sides
 * shared code, a protocol mistake would cancel itself out and the tests would
 * still pass.
 */
export class EngineClient {
  #child;
  #chunks = [];
  #buffered = 0;
  #need = 8;
  #pending = new Map();
  #nextId = 1;
  /** Unsolicited frames, kept so tests can assert on job lifecycle events. */
  events = [];

  constructor(executablePath) {
    this.#child = spawn(executablePath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.#child.stdout.on('data', (chunk) => this.#onData(chunk));
  }

  /** Joins pending chunks only when a frame boundary might have been reached;
   *  concatenating per chunk would be quadratic in the payload size. */
  #coalesce() {
    if (this.#chunks.length > 1) this.#chunks = [Buffer.concat(this.#chunks, this.#buffered)];
    return this.#chunks[0] ?? Buffer.alloc(0);
  }

  #onData(chunk) {
    this.#chunks.push(chunk);
    this.#buffered += chunk.length;
    for (;;) {
      if (this.#buffered < this.#need) return;

      let buffer = this.#coalesce();
      const headerLength = buffer.readUInt32LE(0);
      if (this.#buffered < 4 + headerLength + 4) {
        this.#need = 4 + headerLength + 4;
        return;
      }
      buffer = this.#coalesce();
      const payloadLength = buffer.readUInt32LE(4 + headerLength);
      const total = 4 + headerLength + 4 + payloadLength;
      if (this.#buffered < total) {
        this.#need = total;
        return;
      }

      buffer = this.#coalesce();
      const header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString('utf8'));
      const payload = Buffer.from(buffer.subarray(4 + headerLength + 4, total));
      this.#chunks = total < buffer.length ? [buffer.subarray(total)] : [];
      this.#buffered -= total;
      this.#need = 8;

      if (header.type === 'event') {
        this.events.push(header);
        continue;
      }
      const settle = this.#pending.get(header.id);
      if (settle === undefined) continue;
      this.#pending.delete(header.id);
      settle({ header, payload });
    }
  }

  request(method, params, coalesceKey) {
    const id = this.#nextId++;
    const header = Buffer.from(
      JSON.stringify({ type: 'request', id, method, params, coalesceKey }),
      'utf8',
    );
    const frame = Buffer.alloc(4 + header.length + 4);
    frame.writeUInt32LE(header.length, 0);
    header.copy(frame, 4);
    frame.writeUInt32LE(0, 4 + header.length);

    const promise = new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#child.stdin.write(frame);
    });
    // The id is the job id: tests need it to cancel work already in flight.
    promise.jobId = id;
    return promise;
  }

  /** Resolves to the result, or throws with the engine's own error detail. */
  async call(method, params, coalesceKey) {
    const { header, payload } = await this.request(method, params, coalesceKey);
    if (header.ok !== true) {
      const error = header.error ?? {};
      throw new Error(`${method} failed: ${error.code} - ${error.message} (${error.detail ?? ''})`);
    }
    return { result: header.result, payload };
  }

  close() {
    this.#child.stdin.end();
  }
}
