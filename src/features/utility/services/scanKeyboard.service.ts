import { DeviceEventEmitter, PermissionsAndroid, Platform } from 'react-native';
import NativeScanKeyboard from '@/specs/NativeScanKeyboard';
import { logger } from '@/shared/utils';
import type { GunSuffix } from '../types';

/*
 * Scanner gun: the phone is a Bluetooth keyboard for a paired computer
 * (see src/specs/NativeScanKeyboard.ts). JS mirrors the native status and
 * forwards the user's choices; all typing happens natively.
 */

export const KB_STATES = [
  'unsupported',
  'permission',
  'bluetooth_off',
  'stopped',
  'starting',
  'ready',
  'connecting',
  'connected',
] as const;
export type KbState = (typeof KB_STATES)[number];

export interface KbStatus {
  state: KbState;
  host: { name: string; address: string } | null;
  connecting: string | null;
  phoneName: string;
}

export interface KbHost {
  name: string;
  address: string;
  computer: boolean;
  connected: boolean;
  last: boolean;
}

export interface GunScan {
  value: string;
  format: string;
  typed: boolean;
}

export const EMPTY_KB: KbStatus = {
  state: 'unsupported',
  host: null,
  connecting: null,
  phoneName: '',
};

type R = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function json(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function parseKbStatus(raw: string): KbStatus {
  const o = json(raw);
  if (!o || typeof o !== 'object') return EMPTY_KB;
  const r = o as R;
  const state = (KB_STATES as readonly string[]).includes(r.state as string)
    ? (r.state as KbState)
    : 'unsupported';
  const h = r.host as R | undefined;
  return {
    state,
    host:
      h && typeof h === 'object' && str(h.address)
        ? { name: str(h.name) || str(h.address), address: str(h.address) }
        : null,
    connecting: str(r.connecting) || null,
    phoneName: str(r.phoneName),
  };
}

export function parseHosts(raw: string): KbHost[] {
  const o = json(raw);
  if (!Array.isArray(o)) return [];
  return o
    .filter((h): h is R => !!h && typeof h === 'object' && !!str(h.address))
    .map(h => ({
      name: str(h.name) || str(h.address),
      address: str(h.address),
      computer: h.computer === true,
      connected: h.connected === true,
      last: h.last === true,
    }));
}

export function parseGunScans(raw: string): GunScan[] {
  const o = json(raw);
  if (!Array.isArray(o)) return [];
  return o
    .filter((s): s is R => !!s && typeof s === 'object' && !!str(s.value))
    .map(s => ({
      value: str(s.value),
      format: str(s.format) || 'UNKNOWN',
      typed: s.typed === true,
    }));
}

/** The key pressed after each code. */
export const suffixText = (s: GunSuffix): string =>
  s === 'enter' ? '\n' : s === 'tab' ? '\t' : '';

const M = NativeScanKeyboard;
const BT_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
];

export const scanKeyboard = {
  available: !!M,

  async status(): Promise<KbStatus> {
    if (!M) return EMPTY_KB;
    return parseKbStatus(await M.getStatus());
  },

  onStatus(listener: (s: KbStatus) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'ScanKeyboardStatus',
      (e: { body?: string }) => listener(parseKbStatus(e.body ?? '{}')),
    );
    return () => sub.remove();
  },

  /** Android 12+ asks for "Nearby devices"; true when granted (or not needed). */
  async requestPermission(): Promise<boolean> {
    if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return true;
    const r = await PermissionsAndroid.requestMultiple(BT_PERMISSIONS);
    return r[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === 'granted';
  },

  async start(): Promise<KbState> {
    if (!M) return 'unsupported';
    const s = await M.start();
    return (KB_STATES as readonly string[]).includes(s)
      ? (s as KbState)
      : 'unsupported';
  },
  stop: () => M?.stop(),

  async hosts(): Promise<KbHost[]> {
    if (!M) return [];
    return parseHosts(await M.getHosts());
  },
  connect: async (address: string) => (M ? M.connect(address) : false),
  disconnect: () => M?.disconnect(),
  makeDiscoverable: () => M?.makeDiscoverable(),
  openBluetoothSettings: () => M?.openBluetoothSettings(),

  /** Characters that could not be typed, or null when no computer is connected. */
  async type(text: string): Promise<number | null> {
    if (!M) return null;
    try {
      return await M.typeText(text);
    } catch (error) {
      logger.warn('scan keyboard: not typed', (error as Error)?.message);
      return null;
    }
  },

  async startGun(options: {
    suffix: GunSuffix;
    beep: boolean;
    vibrate: boolean;
    labels: Record<string, string>;
  }): Promise<GunScan[]> {
    if (!M) return [];
    const raw = await M.startScanGun(
      JSON.stringify({ ...options, suffix: suffixText(options.suffix) }),
    );
    return parseGunScans(raw);
  },
};
