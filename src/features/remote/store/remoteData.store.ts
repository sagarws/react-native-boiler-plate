import { storage, StorageKeys } from '@/store/mmkv';
import { fromBase64, toBase64 } from '../core/bytes';
import { cleanText, parseDeviceId } from '../core/ids';
import type { KdfParams } from '../core/crypto';
import type {
  HistoryEntry,
  KnownPeer,
  RemotePlatform,
  SavedDevice,
} from '../types';

/*
 * Remote Access data (MMKV): this phone's identity key, saved devices with
 * their pinned key fingerprints, devices that connected here (trusted /
 * blocked), the unattended-password verifier and the history. Every read is
 * shape-checked; a damaged entry is dropped rather than trusted.
 */

const MAX_DEVICES = 100;
const MAX_HISTORY = 200;
const PLATFORMS: readonly RemotePlatform[] = [
  'darwin',
  'win32',
  'linux',
  'android',
  'ios',
];

const readJson = (key: string): unknown => {
  try {
    return JSON.parse(storage.getString(key) ?? 'null');
  } catch {
    return null;
  }
};

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => !!v && typeof v === 'object',
      )
    : [];

// ── identity ────────────────────────────────────────────────────────────────

/** The Ed25519 seed, or null before the first start. */
export const loadIdentitySecret = (): Uint8Array | null => {
  const raw = storage.getString(StorageKeys.RemoteIdentity);
  if (!raw) return null;
  const seed = fromBase64(raw);
  return seed.length === 32 ? seed : null;
};

export const saveIdentitySecret = (seed: Uint8Array): void =>
  storage.set(StorageKeys.RemoteIdentity, toBase64(seed));

// ── saved devices ───────────────────────────────────────────────────────────

const cleanDevice = (r: Record<string, unknown>): SavedDevice | null => {
  const id = typeof r.id === 'string' ? parseDeviceId(r.id) : null;
  if (!id) return null;
  return {
    id,
    name: cleanText(r.name, 64) || id,
    os: cleanText(r.os, 64),
    platform: PLATFORMS.includes(r.platform as RemotePlatform)
      ? (r.platform as RemotePlatform)
      : 'linux',
    address: cleanText(r.address, 255),
    port:
      typeof r.port === 'number' && r.port > 0 && r.port < 65536
        ? r.port
        : 47800,
    fingerprint: cleanText(r.fingerprint, 64),
    favorite: r.favorite === true,
    lastConnectedAt:
      typeof r.lastConnectedAt === 'number' ? r.lastConnectedAt : null,
  };
};

export const loadDevices = (): SavedDevice[] =>
  list(readJson(StorageKeys.RemoteDevices))
    .map(cleanDevice)
    .filter((d): d is SavedDevice => d !== null);

export const saveDevices = (devices: SavedDevice[]): void =>
  storage.set(
    StorageKeys.RemoteDevices,
    JSON.stringify(devices.slice(0, MAX_DEVICES)),
  );

// ── peers that connected to this phone ──────────────────────────────────────

export interface PeerLists {
  trusted: KnownPeer[];
  blocked: KnownPeer[];
}

const cleanPeer = (r: Record<string, unknown>): KnownPeer | null => {
  const id = typeof r.id === 'string' ? parseDeviceId(r.id) : null;
  if (!id) return null;
  return {
    id,
    name: cleanText(r.name, 64) || id,
    fingerprint: cleanText(r.fingerprint, 64),
    firstSeen: typeof r.firstSeen === 'number' ? r.firstSeen : 0,
    lastSeen: typeof r.lastSeen === 'number' ? r.lastSeen : 0,
  };
};

export const loadPeers = (): PeerLists => {
  const raw = readJson(StorageKeys.RemotePeers) as Record<
    string,
    unknown
  > | null;
  const of = (v: unknown) =>
    list(v)
      .map(cleanPeer)
      .filter((p): p is KnownPeer => p !== null);
  return { trusted: of(raw?.trusted), blocked: of(raw?.blocked) };
};

export const savePeers = (peers: PeerLists): void =>
  storage.set(
    StorageKeys.RemotePeers,
    JSON.stringify({
      trusted: peers.trusted.slice(0, MAX_DEVICES),
      blocked: peers.blocked.slice(0, MAX_DEVICES),
    }),
  );

// ── unattended password ─────────────────────────────────────────────────────

export interface StoredUnattended {
  salt: Uint8Array;
  params: KdfParams;
  verifier: Uint8Array;
}

export const loadUnattended = (): StoredUnattended | null => {
  const r = readJson(StorageKeys.RemoteUnattended) as Record<
    string,
    unknown
  > | null;
  if (!r || typeof r.salt !== 'string' || typeof r.verifier !== 'string')
    return null;
  const params = r.params as KdfParams | undefined;
  if (
    !params ||
    typeof params.t !== 'number' ||
    typeof params.m !== 'number' ||
    typeof params.p !== 'number'
  )
    return null;
  const salt = fromBase64(r.salt);
  const verifier = fromBase64(r.verifier);
  if (salt.length < 16 || verifier.length !== 32) return null;
  return { salt, params: { t: params.t, m: params.m, p: params.p }, verifier };
};

export const saveUnattended = (value: StoredUnattended | null): void => {
  if (!value) {
    storage.delete(StorageKeys.RemoteUnattended);
    return;
  }
  storage.set(
    StorageKeys.RemoteUnattended,
    JSON.stringify({
      salt: toBase64(value.salt),
      params: value.params,
      verifier: toBase64(value.verifier),
    }),
  );
};

// ── history ─────────────────────────────────────────────────────────────────

export const loadHistory = (): HistoryEntry[] =>
  list(readJson(StorageKeys.RemoteHistory))
    .filter(r => typeof r.at === 'number' && typeof r.event === 'string')
    .map(r => ({
      at: r.at as number,
      direction: r.direction === 'incoming' ? 'incoming' : 'outgoing',
      event: r.event as HistoryEntry['event'],
      peerId: cleanText(r.peerId, 16),
      peerName: cleanText(r.peerName, 64),
      detail: cleanText(r.detail, 300),
    }));

export const appendHistory = (entry: HistoryEntry): HistoryEntry[] => {
  const next = [entry, ...loadHistory()].slice(0, MAX_HISTORY);
  storage.set(StorageKeys.RemoteHistory, JSON.stringify(next));
  return next;
};

export const clearHistory = (): void =>
  storage.delete(StorageKeys.RemoteHistory);
