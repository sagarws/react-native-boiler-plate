export type Resolution = '480p' | '720p' | '1080p';
export type FrameRate = 15 | 24 | 30;
export type Facing = 'front' | 'back';
export type Access = 'public' | 'private';

/** Saved preferences (MMKV). The stream password is never saved. */
export interface LiveCameraSettings {
  /** Streaming server base URL, e.g. https://203-0-113-25.sslip.io. */
  serverUrl: string;
  resolution: Resolution;
  fps: FrameRate;
  audio: boolean;
  title: string;
  access: Access;
  maxViewers: number;
  facing: Facing;
}

/** The stream as the server reports it to its owner. */
export interface RemoteStream {
  id: string;
  publicId: string | null;
  viewerUrl: string | null;
  live: boolean;
  viewers: number;
  title: string;
  access: Access;
  maxViewers: number;
  hasPassword: boolean;
  createdAt: number;
  expiresAt: number;
}

export interface CreatedStream extends RemoteStream {
  ownerToken: string;
  whipUrl: string;
  iceServers: IceServer[];
}

export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export type ConnectionQuality = 'good' | 'fair' | 'poor' | 'unknown';

export interface PublishStats {
  width: number;
  height: number;
  fps: number;
  /** Upload, kilobits per second. */
  kbps: number;
  rttMs: number | null;
  quality: ConnectionQuality;
}

export type Phase =
  | 'idle' // camera off
  | 'preview' // camera on, not streaming
  | 'starting'
  | 'live'
  | 'reconnecting';

export type CameraPermission = 'unknown' | 'granted' | 'denied' | 'blocked';

export interface NetworkState {
  online: boolean;
  transport: 'wifi' | 'cellular' | 'ethernet' | 'other' | 'none';
}

export interface LiveCameraState {
  phase: Phase;
  /** react-native-webrtc stream URL for RTCView, while the camera is open. */
  previewUrl: string | null;
  facing: Facing;
  permission: CameraPermission;
  cameras: { front: boolean; back: boolean } | null;
  stream: RemoteStream | null;
  startedAt: number | null;
  stats: PublishStats | null;
  network: NetworkState | null;
  /** i18n key suffix under liveCamera.errors, or null. */
  error: string | null;
  /** The foreground service could not start (streaming stops when minimised). */
  backgroundWarning: boolean;
  /** Link / settings change in flight. */
  busy: boolean;
}
