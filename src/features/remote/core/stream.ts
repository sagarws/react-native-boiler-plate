/**
 * A bidirectional byte pipe — a TCP socket, a WebSocket to the relay, or (in
 * tests) a Node socket. The protocol layers above only see this interface.
 *
 * Data that arrives while nobody listens is held, and `unshift` puts bytes
 * back in front, so the relay's line reader can hand the rest of a chunk to
 * the session channel that takes over the pipe.
 */
export interface StreamListener {
  data(bytes: Uint8Array): void;
  close(reason: string): void;
}

export abstract class ByteStream {
  abstract readonly remoteAddress: string;
  private listener: StreamListener | null = null;
  private pending: Uint8Array[] = [];
  private closedReason: string | null = null;

  get closed(): boolean {
    return this.closedReason !== null;
  }

  /** Send bytes; ignored once closed. */
  abstract write(bytes: Uint8Array): void;
  /** Close after what was written so far is sent. */
  abstract end(): void;
  /** Close at once. */
  abstract destroy(): void;

  listen(listener: StreamListener | null): void {
    this.listener = listener;
    if (!listener) return;
    while (this.pending.length && this.listener === listener) {
      listener.data(this.pending.shift()!);
    }
    if (this.closedReason !== null && this.listener === listener) {
      listener.close(this.closedReason);
    }
  }

  /** Bytes read too early: they are delivered again to the next listener. */
  unshift(bytes: Uint8Array): void {
    if (bytes.length) this.pending.unshift(bytes);
  }

  /** Called by implementations. */
  protected received(bytes: Uint8Array): void {
    if (this.closedReason !== null || !bytes.length) return;
    if (this.listener) this.listener.data(bytes);
    else this.pending.push(bytes);
  }

  /** Called by implementations, once. */
  protected finished(reason: string): void {
    if (this.closedReason !== null) return;
    this.closedReason = reason;
    this.listener?.close(reason);
  }
}
