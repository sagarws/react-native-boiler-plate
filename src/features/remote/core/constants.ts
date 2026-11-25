/**
 * Remote Access wire constants. They mirror the desktop Featured App
 * (shared/constants/remote.ts there) and must stay identical to it, or the
 * phone and the computer stop understanding each other.
 */

export const PROTOCOL_LABEL = 'featured-remote-desktop/v1';
export const RELAY_REGISTER_LABEL = 'featured-remote-relay/v1 register';
export const DISCOVERY_TAG = 'featured-rd';

/** Spoken on the wire; a peer with another version is refused. */
export const REMOTE_PROTOCOL_VERSION = 1;

/** A device ID is 8 digits: 19304289. */
export const DEVICE_ID_DIGITS = 8;
export const LEGACY_DEVICE_ID_PREFIX = 'WD';

/** TCP port for sessions; LAN discovery uses the next one over UDP. */
export const DEFAULT_REMOTE_PORT = 47800;

export const KEEPALIVE_MS = 2000;
export const LINK_TIMEOUT_MS = 8000;
export const RESUME_WINDOW_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 60_000;
export const EXPIRY_WARNING_MS = 5 * 60_000;
export const DIRECT_DIAL_TIMEOUT_MS = 2500;
export const HELLO_TIMEOUT_MS = 10_000;

/** Before authentication a peer may not make us buffer much. */
export const HANDSHAKE_MAX_FRAME = 64 * 1024;
export const SESSION_MAX_FRAME = 2 * 1024 * 1024;

export const MIN_PASSWORD_LENGTH = 8;

/** Discovery: announce every 5 s; a device silent for 16 s is offline. */
export const ANNOUNCE_MS = 5000;
export const ONLINE_MS = 16_000;

export const SESSION_MINUTES = [5, 10, 15, 30, 60, 120, 240, 0] as const;
export const DEFAULT_SESSION_MINUTES = 30;

/**
 * The Featured App remote server — how two devices on DIFFERENT networks
 * reach each other. Kept equal to the desktop app's REMOTE_SERVER so a phone
 * and a computer meet on the same relay out of the box; Settings → Remote
 * Access overrides it on this phone.
 *
 * The VPS relay (plain TCP, PM2 on 89.116.32.17).
 */
export const REMOTE_SERVER = {
  relay: '89.116.32.17:47900',
  // Free public STUN, two providers (keeps that load off the VPS).
  stun: [
    'stun:stun.cloudflare.com:3478',
    'stun:stun.l.google.com:19302',
  ] as readonly string[],
  // TURN comes from the relay as a short-lived login (TURN_SECRET on the VPS,
  // see Featured-App tools/remote-relay/deploy/setup-turn.sh). A fixed login
  // here is only a fallback for a relay without it:
  // { urls: ['turn:IP:3478?transport=udp'], username: 'featured', credential: '…' }
  turn: null as {
    urls: readonly string[];
    username: string;
    credential: string;
  } | null,
};
