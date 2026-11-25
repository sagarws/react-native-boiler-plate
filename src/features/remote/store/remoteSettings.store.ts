import { storage, StorageKeys } from '@/store/mmkv';
import { DEFAULT_SESSION_MINUTES, SESSION_MINUTES } from '../core/constants';
import { normaliseIceUrl, normaliseRelay } from '../core/ids';
import type {
  QualityPreset,
  QualityPriority,
  RemotePermission,
  RemoteSettings,
  SessionMinutes,
  TouchMode,
} from '../types';

/**
 * Remote Access preferences (MMKV). Incoming access starts OFF on a phone —
 * unlike the desktop — and unattended access is off until a password is set.
 * Invalid stored values fall back to these defaults.
 */

export const QUALITY_PRESETS: readonly QualityPreset[] = [
  'auto',
  'ultra-low',
  'low',
  'balanced',
  'high',
  'ultra',
];
const PRIORITIES: readonly QualityPriority[] = [
  'readability',
  'responsiveness',
];
const TOUCH_MODES: readonly TouchMode[] = ['direct', 'trackpad'];
const PERMISSIONS: readonly RemotePermission[] = ['control', 'view'];

export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = {
  defaultQuality: 'auto',
  priority: 'readability',
  touchMode: 'direct',
  viewOnly: false,
  rememberPasswords: true,
  keepAwake: true,
  allowIncoming: false,
  deviceName: '',
  defaultMinutes: DEFAULT_SESSION_MINUTES,
  unattendedEnabled: false,
  unattendedPermission: 'control',
  lanDiscovery: true,
  relay: '',
  turnUrl: '',
  turnUsername: '',
  turnCredential: '',
};

const pick = <T>(value: unknown, list: readonly T[], fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const cleanRemoteSettings = (value: unknown): RemoteSettings => {
  const d = DEFAULT_REMOTE_SETTINGS;
  if (!value || typeof value !== 'object') return d;
  const r = value as Partial<Record<keyof RemoteSettings, unknown>>;
  return {
    defaultQuality: pick(r.defaultQuality, QUALITY_PRESETS, d.defaultQuality),
    priority: pick(r.priority, PRIORITIES, d.priority),
    touchMode: pick(r.touchMode, TOUCH_MODES, d.touchMode),
    viewOnly: bool(r.viewOnly, d.viewOnly),
    rememberPasswords: bool(r.rememberPasswords, d.rememberPasswords),
    keepAwake: bool(r.keepAwake, d.keepAwake),
    allowIncoming: bool(r.allowIncoming, d.allowIncoming),
    deviceName: text(r.deviceName, 64),
    defaultMinutes: pick(
      r.defaultMinutes as SessionMinutes,
      SESSION_MINUTES,
      d.defaultMinutes as SessionMinutes,
    ),
    unattendedEnabled: bool(r.unattendedEnabled, d.unattendedEnabled),
    unattendedPermission: pick(
      r.unattendedPermission,
      PERMISSIONS,
      d.unattendedPermission,
    ),
    lanDiscovery: bool(r.lanDiscovery, d.lanDiscovery),
    relay: normaliseRelay(r.relay),
    turnUrl: normaliseIceUrl(r.turnUrl),
    turnUsername: text(r.turnUsername, 255),
    turnCredential: text(r.turnCredential, 255),
  };
};

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: RemoteSettings | null = null;

const read = (): RemoteSettings => {
  if (!cache) {
    try {
      cache = cleanRemoteSettings(
        JSON.parse(storage.getString(StorageKeys.RemoteSettings) ?? 'null'),
      );
    } catch {
      cache = DEFAULT_REMOTE_SETTINGS;
    }
  }
  return cache;
};

export const remoteSettingsStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  update(patch: Partial<RemoteSettings>): RemoteSettings {
    cache = cleanRemoteSettings({ ...read(), ...patch });
    storage.set(StorageKeys.RemoteSettings, JSON.stringify(cache));
    listeners.forEach(l => l());
    return cache;
  },
  resetCacheForTest() {
    cache = null;
    listeners.clear();
  },
};
