import { gcm } from '@noble/ciphers/aes.js';
import { concatBytes, fromUtf8, readU32be, u32be, utf8 } from './bytes';
import { HANDSHAKE_MAX_FRAME } from './constants';
import type { ByteStream } from './stream';

/*
 * One connection as a stream of messages — the desktop app's Channel
 * (electron/main/remote/core/channel.ts), same bytes on the wire:
 *
 * Frame:   [u32 length][payload]
 * Payload: before keys — the message itself;
 *          after keys  — AES-256-GCM(message) ‖ 16-byte tag, nonce = 4 zero
 *          bytes ‖ u64 counter. Each direction has its own key and counter;
 *          a receiver accepts only the next counter, so a replayed, dropped,
 *          reordered or altered frame ends the connection.
 * Message: [u8 kind][u32 json length][json][binary…]
 */

const TAG_BYTES = 16;

export type WireMessage = Record<string, unknown> & { t: string };

export interface Received {
  msg: WireMessage;
  binary: Uint8Array | null;
}

export class ChannelClosedError extends Error {
  constructor(message = 'The connection closed.') {
    super(message);
    this.name = 'ChannelClosedError';
  }
}

const nonceFor = (counter: bigint): Uint8Array => {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, counter);
  return nonce;
};

type Waiter<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

export class Channel {
  maxFrame = HANDSHAKE_MAX_FRAME;
  lastReceivedAt = Date.now();
  private buffer: Uint8Array = new Uint8Array(0);
  private sendKey: Uint8Array | null = null;
  private recvKey: Uint8Array | null = null;
  private sendCounter = 0n;
  private recvCounter = 0n;
  private rawMode = true;
  private rawQueue: Uint8Array[] = [];
  private rawWaiters: Waiter<Uint8Array>[] = [];
  private queue: Received[] = [];
  private waiters: Waiter<Received>[] = [];
  private pushHandler: ((item: Received) => void) | null = null;
  private closeHandlers: ((reason: string) => void)[] = [];
  private closeReason: string | null = null;

  constructor(readonly stream: ByteStream) {
    stream.listen({
      data: bytes => this.onData(bytes),
      close: reason => this.finish(reason),
    });
  }

  get isClosed(): boolean {
    return this.closeReason !== null;
  }

  get remoteAddress(): string {
    return this.stream.remoteAddress;
  }

  onClose(handler: (reason: string) => void): () => void {
    if (this.closeReason !== null) {
      handler(this.closeReason);
      return () => undefined;
    }
    this.closeHandlers.push(handler);
    return () => {
      this.closeHandlers = this.closeHandlers.filter(h => h !== handler);
    };
  }

  /** Switch to encrypted frames, from the next frame on, both directions. */
  setKeys(sendKey: Uint8Array, recvKey: Uint8Array): void {
    this.sendKey = sendKey;
    this.recvKey = recvKey;
  }

  /** Raw frame: the hello messages, whose exact bytes are hashed into the transcript. */
  sendRaw(payload: Uint8Array): void {
    if (this.isClosed)
      throw new ChannelClosedError(this.closeReason ?? undefined);
    this.stream.write(concatBytes(u32be(payload.length), payload));
  }

  send(msg: WireMessage, binary?: Uint8Array): boolean {
    if (this.isClosed) return false;
    const json = utf8(JSON.stringify(msg));
    const head = new Uint8Array(5);
    head[0] = binary ? 1 : 0;
    head.set(u32be(json.length), 1);
    let payload = binary
      ? concatBytes(head, json, binary)
      : concatBytes(head, json);
    if (this.sendKey) {
      payload = gcm(this.sendKey, nonceFor(this.sendCounter++)).encrypt(
        payload,
      );
    }
    this.stream.write(concatBytes(u32be(payload.length), payload));
    return true;
  }

  receiveRaw(timeoutMs: number): Promise<Uint8Array> {
    const next = this.rawQueue.shift();
    if (next) return Promise.resolve(next);
    return this.wait(this.rawWaiters, timeoutMs);
  }

  receive(timeoutMs: number): Promise<Received> {
    const next = this.queue.shift();
    if (next) return Promise.resolve(next);
    return this.wait(this.waiters, timeoutMs);
  }

  private wait<T>(list: Waiter<T>[], timeoutMs: number): Promise<T> {
    if (this.isClosed)
      return Promise.reject(
        new ChannelClosedError(this.closeReason ?? undefined),
      );
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter<T> = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = list.indexOf(waiter);
        if (index >= 0) list.splice(index, 1);
        reject(new Error('The other device did not answer in time.'));
      }, timeoutMs);
      list.push(waiter);
    });
  }

  /** From now on frames are parsed as messages (after the hello frames). */
  endRawMode(): void {
    this.rawMode = false;
    const pending = this.rawQueue;
    this.rawQueue = [];
    for (const frame of pending) this.onFrame(frame);
  }

  /** From now on every message goes to `handler` instead of the queue. */
  startPushMode(handler: (item: Received) => void): void {
    this.pushHandler = handler;
    const pending = this.queue;
    this.queue = [];
    for (const item of pending) handler(item);
  }

  close(reason = 'Closed.'): void {
    this.finish(reason);
    this.stream.destroy();
  }

  /** Send a last message, then close once it is flushed (or after a short grace). */
  closeAfter(msg: WireMessage): void {
    if (this.isClosed) return;
    this.send(msg);
    this.stream.end();
    setTimeout(() => this.close('Closed.'), 1000);
  }

  private finish(reason: string): void {
    if (this.closeReason !== null) return;
    this.closeReason = reason;
    const error = new ChannelClosedError(reason);
    for (const w of [...this.waiters, ...this.rawWaiters]) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(error);
    }
    this.waiters = [];
    this.rawWaiters = [];
    const handlers = this.closeHandlers;
    this.closeHandlers = [];
    for (const h of handlers) h(reason);
  }

  private onData(data: Uint8Array): void {
    if (this.isClosed) return;
    this.lastReceivedAt = Date.now();
    this.buffer = this.buffer.length ? concatBytes(this.buffer, data) : data;
    while (this.buffer.length >= 4) {
      const length = readU32be(this.buffer);
      if (length > this.maxFrame) return this.close('Message too large.');
      if (this.buffer.length < 4 + length) return;
      const frame = this.buffer.slice(4, 4 + length);
      this.buffer = this.buffer.subarray(4 + length);
      if (this.rawMode) {
        const waiter = this.rawWaiters.shift();
        if (waiter) {
          if (waiter.timer) clearTimeout(waiter.timer);
          waiter.resolve(frame);
        } else {
          this.rawQueue.push(frame);
          if (this.rawQueue.length > 4) return this.close('Unexpected data.');
        }
      } else {
        this.onFrame(frame);
      }
      if (this.isClosed) return;
    }
  }

  private onFrame(frame: Uint8Array): void {
    let payload = frame;
    if (this.recvKey) {
      if (frame.length < TAG_BYTES + 5) return this.close('Corrupt message.');
      try {
        payload = gcm(this.recvKey, nonceFor(this.recvCounter)).decrypt(frame);
        this.recvCounter++;
      } catch {
        // Altered, replayed, reordered or wrong key: never act on it.
        return this.close('A message failed its integrity check.');
      }
    }
    if (payload.length < 5) return this.close('Corrupt message.');
    const kind = payload[0];
    const jsonLength = readU32be(payload, 1);
    if (5 + jsonLength > payload.length) return this.close('Corrupt message.');
    let msg: unknown;
    try {
      msg = JSON.parse(fromUtf8(payload.subarray(5, 5 + jsonLength)));
    } catch {
      return this.close('Corrupt message.');
    }
    if (
      !msg ||
      typeof msg !== 'object' ||
      typeof (msg as WireMessage).t !== 'string'
    )
      return this.close('Corrupt message.');
    const item: Received = {
      msg: msg as WireMessage,
      binary: kind === 1 ? payload.slice(5 + jsonLength) : null,
    };
    if (this.pushHandler) return this.pushHandler(item);
    const waiter = this.waiters.shift();
    if (waiter) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(item);
    } else {
      this.queue.push(item);
      if (this.queue.length > 64) this.close('Too many messages.');
    }
  }
}
