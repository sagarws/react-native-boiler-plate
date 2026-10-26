import { io, type Socket } from 'socket.io-client';
import { getApiBaseUrl, subscribeApiBaseUrl } from '@/config';
import { getAuthToken } from '@/services/api';
import { logger } from '@/shared/utils';

// Lazy Socket.IO singleton. Nothing connects until the first `getSocket()`.
//   - same JWT as REST (read fresh on every (re)connect via `auth` callback)
//   - transports prefer websocket, fall back to polling on bad networks
// Re-created when the API base URL override changes, so the dev-endpoint
// setting affects realtime too without a full app restart.
let socket: Socket | null = null;

function create(): Socket {
  const url = getApiBaseUrl();
  const next = io(url, {
    transports: ['websocket', 'polling'],
    auth: (cb: (payload: { token: string }) => void) => {
      getAuthToken()
        .then(token => cb({ token: token ?? '' }))
        .catch(() => cb({ token: '' }));
    },
  });
  next.on('connect_error', (err: Error) => {
    logger.warn('socket connect_error', { message: err.message });
  });
  return next;
}

export function getSocket(): Socket {
  if (!socket) socket = create();
  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

// Reconnect when the API base URL changes (dev endpoint override).
subscribeApiBaseUrl(() => {
  disconnectSocket();
});
