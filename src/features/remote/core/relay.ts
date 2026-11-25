import { concatBytes, fromBase64, fromUtf8, toBase64, utf8 } from './bytes';
import { RELAY_REGISTER_LABEL } from './constants';
import { signTranscript, type LocalIdentity } from './crypto';
import type { ByteStream } from './stream';

/*
 * The app's side of the relay (tools/remote-relay in the desktop repo):
 * line-delimited JSON during setup, then a raw byte pipe on which the normal
 * end-to-end handshake runs. The relay cannot read or alter sessions.
 */

const MAX_LINE = 8 * 1024;

export type OpenStream = (timeoutMs: number) => Promise<ByteStream>;

/** One JSON line; bytes after it are put back on the stream. */
export const readLine = (
  stream: ByteStream,
  timeoutMs: number,
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let buffer: Uint8Array = new Uint8Array(0);
    const timer = setTimeout(() => {
      stream.listen(null);
      reject(new Error('timeout'));
    }, timeoutMs);
    stream.listen({
      data: chunk => {
        buffer = concatBytes(buffer, chunk);
        const newline = buffer.indexOf(10);
        if (newline < 0) {
          if (buffer.length > MAX_LINE) {
            clearTimeout(timer);
            stream.listen(null);
            reject(new Error('line too long'));
          }
          return;
        }
        clearTimeout(timer);
        stream.listen(null);
        stream.unshift(buffer.slice(newline + 1));
        try {
          const value = JSON.parse(
            fromUtf8(buffer.subarray(0, newline)),
          ) as unknown;
          if (!value || typeof value !== 'object') throw new Error('bad line');
          resolve(value as Record<string, unknown>);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
      close: () => {
        clearTimeout(timer);
        stream.listen(null);
        reject(new Error('closed'));
      },
    });
  });

export const writeLine = (
  stream: ByteStream,
  value: Record<string, unknown>,
): void => stream.write(utf8(`${JSON.stringify(value)}\n`));

/** A short-lived TURN login from the relay (desktop: relayClient.ts). */
export interface IceGrant {
  urls: string[];
  username: string;
  credential: string;
  /** Unix ms after which it no longer works. */
  expiresAt: number;
}

/**
 * The relay hands out TURN logins with 'registered', 'ready' and an hourly
 * ping, when its server has coturn. The newest one is used for the video.
 */
let iceListener: ((grant: IceGrant) => void) | null = null;
export const onRelayIce = (
  listener: ((grant: IceGrant) => void) | null,
): void => {
  iceListener = listener;
};

export const parseIceGrant = (value: unknown): IceGrant | null => {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const urls = Array.isArray(v.urls)
    ? v.urls
        .filter(
          (u): u is string =>
            typeof u === 'string' && /^turns?:/i.test(u) && u.length < 256,
        )
        .slice(0, 4)
    : [];
  if (
    !urls.length ||
    typeof v.username !== 'string' ||
    typeof v.credential !== 'string' ||
    typeof v.expiresAt !== 'number' ||
    v.username.length > 128 ||
    v.credential.length > 128
  )
    return null;
  return {
    urls,
    username: v.username,
    credential: v.credential,
    expiresAt: v.expiresAt,
  };
};

const takeIce = (line: Record<string, unknown>): void => {
  const grant = parseIceGrant(line.ice);
  if (grant) iceListener?.(grant);
};

const message = (answer: Record<string, unknown>, fallback: string): string =>
  typeof answer.message === 'string' ? answer.message : fallback;

/** Client: a pipe to `deviceId` through the relay. */
export const dialThroughRelay = async (
  open: OpenStream,
  deviceId: string,
): Promise<ByteStream> => {
  const stream = await open(8000);
  try {
    await readLine(stream, 8000);
    writeLine(stream, { op: 'connect', id: deviceId });
    const answer = await readLine(stream, 15_000);
    if (answer.op !== 'ready')
      throw new Error(message(answer, 'The relay refused the connection.'));
    takeIce(answer);
    return stream;
  } catch (error) {
    stream.destroy();
    throw error instanceof Error ? error : new Error(String(error));
  }
};

/** Is `deviceId` registered on the relay right now? */
export const relayLookup = async (
  open: OpenStream,
  deviceId: string,
): Promise<boolean> => {
  const stream = await open(4000);
  try {
    await readLine(stream, 4000);
    writeLine(stream, { op: 'lookup', id: deviceId });
    const answer = await readLine(stream, 4000);
    return answer.op === 'status' && answer.online === true;
  } finally {
    stream.destroy();
  }
};

export type RelayState = 'off' | 'connecting' | 'online' | 'error';

export interface RelayHostEvents {
  onState: (state: RelayState, error: string | null) => void;
  /** A client is waiting: run the host handshake on this stream. */
  onIncoming: (stream: ByteStream) => void;
}

/** Host: stays registered, reconnecting with backoff, until stopped. */
export class RelayHost {
  private control: ByteStream | null = null;
  private stopped = true;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 2000;

  constructor(
    private readonly open: OpenStream,
    private readonly identity: () => LocalIdentity,
    private readonly events: RelayHostEvents,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connectLoop();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.control?.destroy();
    this.control = null;
    this.events.onState('off', null);
  }

  private scheduleRetry(error: string): void {
    if (this.stopped) return;
    this.events.onState('error', error);
    this.retry = setTimeout(() => {
      this.connectLoop().catch(() => undefined);
    }, this.backoff);
    this.backoff = Math.min(60_000, this.backoff * 2);
  }

  private async connectLoop(): Promise<void> {
    if (this.stopped) return;
    this.events.onState('connecting', null);
    let stream: ByteStream;
    try {
      stream = await this.open(8000);
    } catch (error) {
      return this.scheduleRetry(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (this.stopped) {
      stream.destroy();
      return;
    }
    this.control = stream;
    try {
      const hello = await readLine(stream, 8000);
      const nonce = fromBase64(
        typeof hello.nonce === 'string' ? hello.nonce : '',
      );
      const identity = this.identity();
      const sig = signTranscript(
        identity.secretKey,
        concatBytes(utf8(RELAY_REGISTER_LABEL), nonce),
      );
      writeLine(stream, {
        op: 'register',
        id: identity.id,
        pub: toBase64(identity.publicKey),
        sig: toBase64(sig),
      });
      const answer = await readLine(stream, 8000);
      if (answer.op !== 'registered')
        throw new Error(message(answer, 'The relay refused this device.'));
      takeIce(answer);
    } catch (error) {
      stream.destroy();
      return this.scheduleRetry(
        error instanceof Error ? error.message : String(error),
      );
    }
    this.backoff = 2000;
    this.events.onState('online', null);
    void this.listen(stream);
  }

  private async listen(stream: ByteStream): Promise<void> {
    for (;;) {
      let line: Record<string, unknown>;
      try {
        // The relay pings every 25 s; longer silence means the link is dead.
        line = await readLine(stream, 70_000);
      } catch (error) {
        stream.destroy();
        if (this.control === stream) this.control = null;
        return this.scheduleRetry(
          error instanceof Error ? error.message : 'Lost the relay.',
        );
      }
      if (this.stopped) return;
      if (line.op === 'ping') {
        writeLine(stream, { op: 'pong' });
        takeIce(line);
      } else if (line.op === 'incoming' && typeof line.token === 'string')
        void this.accept(line.token);
    }
  }

  private async accept(token: string): Promise<void> {
    let stream: ByteStream | null = null;
    try {
      stream = await this.open(8000);
      await readLine(stream, 8000);
      writeLine(stream, { op: 'accept', token });
      const answer = await readLine(stream, 8000);
      if (answer.op !== 'ready') throw new Error('not ready');
      takeIce(answer);
      this.events.onIncoming(stream);
    } catch {
      stream?.destroy();
    }
  }
}
