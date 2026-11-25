import { ByteStream } from './stream';

/**
 * The relay over WebSocket (wss://…, e.g. behind Cloudflare Tunnel): the
 * same bytes as plain TCP, inside binary frames. Uses the standard WebSocket
 * API, which React Native provides natively.
 */
export class WebSocketStream extends ByteStream {
  readonly remoteAddress: string;

  private constructor(private readonly ws: WebSocket, url: string) {
    super();
    this.remoteAddress = `relay ${url.replace(/^wss?:\/\//, '')}`;
    ws.onmessage = event => {
      const data = event.data as unknown;
      if (data instanceof ArrayBuffer) this.received(new Uint8Array(data));
      else if (typeof data === 'string') {
        // Not expected from the relay; never mix text into the byte stream.
        this.destroy();
      }
    };
    ws.onclose = () => this.finished('The relay closed the connection.');
    ws.onerror = () => this.finished('The relay connection failed.');
  }

  static open(url: string, timeoutMs: number): Promise<WebSocketStream> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      (ws as WebSocket & { binaryType: string }).binaryType = 'arraybuffer';
      const timer = setTimeout(() => {
        ws.onopen = null;
        ws.onerror = null;
        ws.close();
        reject(new Error('The relay did not answer.'));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new WebSocketStream(ws, url));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Could not reach the relay.'));
      };
    });
  }

  write(bytes: Uint8Array): void {
    if (this.closed || this.ws.readyState !== 1) return;
    // A copy: send() takes the whole underlying buffer.
    this.ws.send(bytes.slice().buffer);
  }

  end(): void {
    // WebSocket send() is queued in order; close() runs after it.
    this.ws.close(1000);
  }

  destroy(): void {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
    this.finished('Closed.');
  }
}
