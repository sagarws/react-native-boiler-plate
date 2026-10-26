import { useEffect, useState } from 'react';
import { subscribeApiBaseUrl } from '@/config';
import { getSocket } from './socket';

export type SocketStatus = 'connected' | 'connecting' | 'disconnected';

// Observable connection status for the singleton socket. Re-binds when the
// API base URL changes (the override flow disposes the old socket), so the
// badge keeps reflecting the current connection rather than the old one.
export function useSocketStatus(): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>(() =>
    getSocket().connected ? 'connected' : 'connecting',
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const bind = () => {
      cleanup?.();
      const socket = getSocket();
      setStatus(socket.connected ? 'connected' : 'connecting');

      const onConnect = () => setStatus('connected');
      const onDisconnect = () => setStatus('disconnected');
      const onError = () => setStatus('disconnected');

      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onError);

      cleanup = () => {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onError);
      };
    };

    bind();
    const unsubBaseUrl = subscribeApiBaseUrl(() => {
      // Override changed → singleton was disposed. Re-bind after a microtask so
      // the next `getSocket()` returns the fresh instance.
      setStatus('connecting');
      setTimeout(bind, 0);
    });

    return () => {
      cleanup?.();
      unsubBaseUrl();
    };
  }, []);

  return status;
}
