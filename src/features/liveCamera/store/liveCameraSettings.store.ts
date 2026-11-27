import { liveCameraServerDefault } from '@/config';
import { storage, StorageKeys } from '@/store/mmkv';
import type {
  Access,
  Facing,
  FrameRate,
  LiveCameraSettings,
  Resolution,
} from '../types';

/**
 * Share Live Camera preferences (MMKV). Defaults follow the spec: 720p,
 * 24 FPS, no audio. Invalid stored values fall back to the defaults.
 */

export const RESOLUTIONS: readonly Resolution[] = ['480p', '720p', '1080p'];
export const FRAME_RATES: readonly FrameRate[] = [15, 24, 30];
export const MAX_VIEWERS_LIMIT = 50;
export const TITLE_MAX = 80;

export const defaultSettings = (): LiveCameraSettings => ({
  serverUrl: liveCameraServerDefault(),
  resolution: '720p',
  fps: 24,
  audio: false,
  title: '',
  access: 'public',
  maxViewers: 10,
  facing: 'back',
});

/** https://host[:port] with no path or trailing slash, or '' when not a URL. */
export const normaliseServerUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const v = value.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/?#]+$/i.test(v) ? v : '';
};

const pick = <T>(value: unknown, list: readonly T[], fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

export const cleanSettings = (value: unknown): LiveCameraSettings => {
  const d = defaultSettings();
  if (!value || typeof value !== 'object') return d;
  const r = value as Partial<Record<keyof LiveCameraSettings, unknown>>;
  const max = Number(r.maxViewers);
  return {
    serverUrl: normaliseServerUrl(r.serverUrl) || d.serverUrl,
    resolution: pick(r.resolution, RESOLUTIONS, d.resolution),
    fps: pick(r.fps as FrameRate, FRAME_RATES, d.fps),
    audio: typeof r.audio === 'boolean' ? r.audio : d.audio,
    title:
      typeof r.title === 'string' ? r.title.trim().slice(0, TITLE_MAX) : '',
    access: pick<Access>(r.access as Access, ['public', 'private'], d.access),
    maxViewers:
      Number.isInteger(max) && max >= 1
        ? Math.min(max, MAX_VIEWERS_LIMIT)
        : d.maxViewers,
    facing: pick<Facing>(r.facing as Facing, ['front', 'back'], d.facing),
  };
};

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: LiveCameraSettings | null = null;

const read = (): LiveCameraSettings => {
  if (!cache) {
    try {
      cache = cleanSettings(
        JSON.parse(storage.getString(StorageKeys.LiveCameraSettings) ?? 'null'),
      );
    } catch {
      cache = defaultSettings();
    }
  }
  return cache;
};

export const liveCameraSettingsStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  update(patch: Partial<LiveCameraSettings>): LiveCameraSettings {
    cache = cleanSettings({ ...read(), ...patch });
    storage.set(StorageKeys.LiveCameraSettings, JSON.stringify(cache));
    listeners.forEach(l => l());
    return cache;
  },
  resetCacheForTest() {
    cache = null;
    listeners.clear();
  },
};
