import TcpSocket from 'react-native-tcp-socket';
import { ByteStream } from '../core/stream';

type NativeSocket = ReturnType<typeof TcpSocket.createConnection>;
type NativeServer = ReturnType<typeof TcpSocket.createServer>;

/** A react-native-tcp-socket connection as a ByteStream. */
export class TcpStream extends ByteStream {
  readonly remoteAddress: string;

  constructor(private readonly socket: NativeSocket, address?: string) {
    super();
    this.remoteAddress = address ?? socket.remoteAddress ?? '?';
    socket.on('data', data => {
      if (typeof data === 'string') return;
      this.received(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(),
      );
    });
    socket.on('close', () => this.finished('The connection closed.'));
    socket.on('error', error =>
      this.finished(error?.message ?? 'Network error.'),
    );
  }

  write(bytes: Uint8Array): void {
    if (this.closed || this.socket.destroyed) return;
    this.socket.write(bytes);
  }

  end(): void {
    if (!this.socket.destroyed) this.socket.end();
  }

  destroy(): void {
    this.socket.destroy();
    this.finished('Closed.');
  }
}

/** Connect to host:port with a timeout; Nagle off (input and signalling are tiny). */
export const dialTcp = (
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TcpStream> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const socket = TcpSocket.createConnection({ host, port }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 5000);
      resolve(new TcpStream(socket, host));
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`No answer from ${host}:${port}.`));
    }, timeoutMs);
    socket.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });

/** Listen for incoming sessions on all interfaces. */
export const listenTcp = (
  port: number,
  onStream: (stream: TcpStream) => void,
): Promise<{ close: () => void }> =>
  new Promise((resolve, reject) => {
    const server: NativeServer = TcpSocket.createServer(socket => {
      socket.setNoDelay(true);
      socket.setKeepAlive(true, 5000);
      onStream(new TcpStream(socket));
    });
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen({ port, host: '0.0.0.0' }, () => {
      server.off('error', onError);
      resolve({ close: () => server.close() });
    });
  });
