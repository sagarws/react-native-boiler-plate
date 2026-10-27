import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';

export type AudioShareState =
  | 'off'
  | 'waiting'
  | 'pending'
  | 'connected'
  | 'streaming';

export type AudioShareError = '' | 'no_wifi' | 'port_failed' | 'unsupported';

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
}

export const AUDIO_SHARE_OFF: AudioShareStatus = {
  state: 'off',
  address: '',
  port: 0,
  receiverName: '',
  fingerprint: '',
  transmitting: false,
  error: '',
};

const STATES: readonly AudioShareState[] = [
  'off',
  'waiting',
  'pending',
  'connected',
  'streaming',
];
const ERRORS: readonly AudioShareError[] = ['', 'no_wifi', 'port_failed'];

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

  respond(approve: boolean): void {
    NativeScreenOcr?.respondAudioShare(approve);
  },

  disconnect(): void {
    NativeScreenOcr?.disconnectAudioShare();
  },
};
