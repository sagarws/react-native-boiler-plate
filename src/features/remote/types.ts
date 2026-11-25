/**
 * Remote Access: see and control a computer or phone running Featured App,
 * or let one control this phone. Wire-compatible with the desktop app
 * (docs/REMOTE_ACCESS.md).
 */

/** Desktop platforms as the desktop sends them, plus the two phones. */
export type RemotePlatform = 'darwin' | 'win32' | 'linux' | 'android' | 'ios';

export type RemotePermission = 'control' | 'view';

export type SessionMinutes = 5 | 10 | 15 | 30 | 60 | 120 | 240 | 0;

export type QualityPreset =
  | 'ultra-low'
  | 'low'
  | 'balanced'
  | 'high'
  | 'ultra'
  | 'auto';

export type QualityPriority = 'readability' | 'responsiveness';

/** direct: the finger is the pointer. trackpad: drag moves a cursor, tap clicks. */
export type TouchMode = 'direct' | 'trackpad';

export interface RemoteSettings {
  // ── this phone as the controller ──
  defaultQuality: QualityPreset;
  priority: QualityPriority;
  touchMode: TouchMode;
  /** Ask for view-only access instead of full control. */
  viewOnly: boolean;
  /** Keep other devices' passwords (sealed) after a successful unattended connection. */
  rememberPasswords: boolean;
  /** Keep the screen awake while viewing. */
  keepAwake: boolean;

  // ── this phone being controlled (Android) ──
  /** Accept incoming connections while the app runs. */
  allowIncoming: boolean;
  /** Friendly name shown to others; '' = the phone's model. */
  deviceName: string;
  defaultMinutes: SessionMinutes;
  /** Connect with the password without anyone accepting. Off by default. */
  unattendedEnabled: boolean;
  unattendedPermission: RemotePermission;

  // ── both ──
  lanDiscovery: boolean;
  /** wss://… or host:port of the relay; '' = the built-in remote server. */
  relay: string;
  /** stun:/turn:/turns: URL; '' = the built-in STUN. */
  turnUrl: string;
  turnUsername: string;
  turnCredential: string;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  os: string;
  platform: RemotePlatform;
  address: string;
  port: number;
  fingerprint: string;
  lastSeen: number;
}

export interface SavedDevice {
  id: string;
  name: string;
  os: string;
  platform: RemotePlatform;
  /** Last LAN address it answered on ('' when reached through the relay). */
  address: string;
  port: number;
  /** Pinned on first connect; a different key later is refused. */
  fingerprint: string;
  favorite: boolean;
  lastConnectedAt: number | null;
}

/** A device that connected to this phone: trusted (seen) or blocked. */
export interface KnownPeer {
  id: string;
  name: string;
  fingerprint: string;
  firstSeen: number;
  lastSeen: number;
}

export type HistoryEvent =
  | 'request'
  | 'accepted'
  | 'rejected'
  | 'auth-failed'
  | 'connected'
  | 'ended'
  | 'reconnected'
  | 'blocked'
  | 'failed';

export interface HistoryEntry {
  at: number;
  direction: 'incoming' | 'outgoing';
  event: HistoryEvent;
  peerId: string;
  peerName: string;
  detail: string;
}

export interface RemoteDisplay {
  id: string;
  label: string;
  primary: boolean;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type SignalMessage =
  | { type: 'offer' | 'answer'; sdp: string }
  | {
      type: 'candidate';
      candidate: string;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    }
  | { type: 'restart' };

/** Viewer → host over the WebRTC data channels. Coordinates are 0–1 of the shared display. */
export type InputEvent =
  | { k: 'mm'; x: number; y: number; s?: number }
  | { k: 'md' | 'mu'; b: 0 | 1 | 2; x: number; y: number }
  | { k: 'wh'; dx: number; dy: number }
  | { k: 'kd' | 'ku'; c: string }
  | { k: 'tx'; t: string }
  | { k: 'rel' };
