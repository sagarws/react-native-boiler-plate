import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import NativeSystemAudio from '@/specs/NativeSystemAudio';

/*
 * "Other apps" mode (see src/specs/NativeSystemAudio.ts for what Android
 * allows). JS only mirrors the native status and forwards the user's choices.
 */

export interface SessionInfo {
  sessionId: number;
  packageName: string;
  appLabel: string;
  attached: boolean;
}

export interface SystemStatus {
  sessions: SessionInfo[];
  effectsEnabled: boolean;
  effectsSupported: Record<
    'equalizer' | 'bassBoost' | 'virtualizer' | 'reverb' | 'loudness',
    boolean
  >;
  capture: {
    supported: boolean;
    running: boolean;
    outputMode: 'media' | 'accessibility';
    inputDb: number;
    outputDb: number;
    silentMs: number;
    latencyMs: number;
    error: string | null;
    /** The original is silenced; only the 8D version is heard. */
    hearOnly8D: boolean;
    /** The 8D volume helper (accessibility service) is switched on. */
    helperOn: boolean;
    /** 8D volume, 0–1. */
    eightDVolume: number;
    /** Media plays to Bluetooth with absolute volume: the original cannot be silenced. */
    btSharedVolume: boolean;
    /** Set when hear-only ended by itself ('bt_shared_volume'). */
    hearOnlyEnded: string | null;
  };
}

export const EMPTY_SYSTEM: SystemStatus = {
  sessions: [],
  effectsEnabled: false,
  effectsSupported: {
    equalizer: false,
    bassBoost: false,
    virtualizer: false,
    reverb: false,
    loudness: false,
  },
  capture: {
    supported: false,
    running: false,
    outputMode: 'media',
    inputDb: -120,
    outputDb: -120,
    silentMs: 0,
    latencyMs: 0,
    error: null,
    hearOnly8D: false,
    helperOn: false,
    eightDVolume: 0,
    btSharedVolume: false,
    hearOnlyEnded: null,
  },
};

export const parseStatus = (json: string): SystemStatus => {
  try {
    const o = JSON.parse(json) as Partial<SystemStatus>;
    return {
      ...EMPTY_SYSTEM,
      ...o,
      sessions: Array.isArray(o.sessions) ? o.sessions : [],
      effectsSupported: {
        ...EMPTY_SYSTEM.effectsSupported,
        ...o.effectsSupported,
      },
      capture: { ...EMPTY_SYSTEM.capture, ...o.capture },
    };
  } catch {
    return EMPTY_SYSTEM;
  }
};

export type HearOnlyResult =
  | 'ok'
  | 'helper_off'
  | 'bt_shared_volume'
  | 'refused';

export type CaptureStart =
  | 'ok'
  | 'unsupported'
  | 'denied'
  | 'permission'
  | 'failed';

const M = NativeSystemAudio;

export const systemAudio = {
  available: !!M,

  async status(): Promise<SystemStatus> {
    if (!M) return EMPTY_SYSTEM;
    return parseStatus(await M.getStatus());
  },

  onStatus(listener: (s: SystemStatus) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'SystemAudioEvent',
      (e: { type?: string; body?: string }) => {
        if (e.type === 'status') listener(parseStatus(e.body ?? '{}'));
      },
    );
    return () => sub.remove();
  },

  setEffectsEnabled: (on: boolean) => M?.setEffectsEnabled(on),
  setEffectParams: (params: number[]) => M?.setEffectParams(params),

  async startCapture(): Promise<CaptureStart> {
    if (!M) return 'unsupported';
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (r !== PermissionsAndroid.RESULTS.GRANTED) return 'permission';
    }
    try {
      await M.startCapture();
      return 'ok';
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'unsupported' ||
        code === 'denied' ||
        code === 'permission'
        ? code
        : 'failed';
    }
  },
  stopCapture: () => M?.stopCapture(),
  async setHearOnly8D(on: boolean): Promise<HearOnlyResult> {
    if (!M) return 'refused';
    const r = await M.setHearOnly8D(on);
    return r === 'ok' || r === 'helper_off' || r === 'bt_shared_volume'
      ? r
      : 'refused';
  },
  openVolumeHelperSettings: () => M?.openVolumeHelperSettings(),
  openDeveloperSettings: () => M?.openDeveloperSettings(),
  setEightDVolume: (v: number) => M?.setEightDVolume(v),
  setCaptureOutput: (mode: 'media' | 'accessibility') =>
    M?.setCaptureOutput(mode),
};
