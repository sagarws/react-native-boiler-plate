import { PermissionsAndroid, Platform } from 'react-native';
import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';

export type AudioShareState =
  | 'off'
  | 'waiting'
  | 'pending'
  | 'connected'
  | 'streaming';

export type AudioShareError = '' | 'no_wifi' | 'port_failed' | 'unsupported';

/** "All phone audio": running, or why not. */
export type DeviceAudioState =
  | 'off'
  | 'idle'
  | 'active'
  | 'needs_permission'
  | 'needs_bubble'
  | 'unsupported'
  | 'failed';

/** What the phone's audio-sharing server reports (see AudioShareHub). */
export interface AudioShareStatus {
  state: AudioShareState;
  /** Phone's Wi-Fi IPv4 address, '' when not on Wi-Fi. */
  address: string;
  port: number;
  receiverName: string;
  /** Six digits both screens show while a connection waits for approval. */
  fingerprint: string;
  /** Audio was sent in the last ~1.5 s. */
  transmitting: boolean;
  error: AudioShareError;
  deviceAudio: DeviceAudioState;
}

export const AUDIO_SHARE_OFF: AudioShareStatus = {
  state: 'off',
  address: '',
  port: 0,
  receiverName: '',
  fingerprint: '',
  transmitting: false,
  error: '',
  deviceAudio: 'off',
};

const STATES: readonly AudioShareState[] = [
  'off',
  'waiting',
  'pending',
  'connected',
  'streaming',
];
const ERRORS: readonly AudioShareError[] = ['', 'no_wifi', 'port_failed'];
const DEVICE_STATES: readonly DeviceAudioState[] = [
  'off',
  'idle',
  'active',
  'needs_permission',
  'needs_bubble',
  'unsupported',
  'failed',
];

const str = (v: unknown, max = 80) =>
  typeof v === 'string' ? v.slice(0, max) : '';

export function parseAudioShareStatus(json: string): AudioShareStatus {
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    return {
      state: STATES.includes(r.state as AudioShareState)
        ? (r.state as AudioShareState)
        : 'off',
      address: str(r.address, 45),
      port: typeof r.port === 'number' ? r.port : 0,
      receiverName: str(r.receiverName, 40),
      fingerprint: str(r.fingerprint, 8),
      transmitting: r.transmitting === true,
      error: ERRORS.includes(r.error as AudioShareError)
        ? (r.error as AudioShareError)
        : '',
      deviceAudio: DEVICE_STATES.includes(r.deviceAudio as DeviceAudioState)
        ? (r.deviceAudio as DeviceAudioState)
        : 'off',
    };
  } catch {
    return AUDIO_SHARE_OFF;
  }
}

/**
 * Sharing the spoken voice with the Chrome extension. Starting and stopping
 * follow `settings.audioShare.enabled` (pushed with the native config).
 */
export const audioShareService = {
  async getStatus(): Promise<AudioShareStatus> {
    if (!NativeScreenOcr) return { ...AUDIO_SHARE_OFF, error: 'unsupported' };
    try {
      return parseAudioShareStatus(await NativeScreenOcr.getAudioShareStatus());
    } catch (error) {
      logger.error('audioShare.getStatus failed', error);
      return AUDIO_SHARE_OFF;
    }
  },

  /**
   * Android gates playback capture ("all phone audio") behind the RECORD_AUDIO
   * permission. Nothing is recorded from the microphone.
   */
  async requestCapturePermission(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    } catch (error) {
      logger.error('audioShare.requestCapturePermission failed', error);
      return false;
    }
  },

  respond(approve: boolean): void {
    NativeScreenOcr?.respondAudioShare(approve);
  },

  disconnect(): void {
    NativeScreenOcr?.disconnectAudioShare();
  },
};
