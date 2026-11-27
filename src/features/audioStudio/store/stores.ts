import { StorageKeys } from '@/store/mmkv';
import { DEFAULT_SETTINGS } from '../dsp/presets';
import type {
  EqProfile,
  Playlist,
  Song,
  SpatialPreset,
  StudioSettings,
} from '../types';
import { createJsonStore } from './jsonStore';

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export const cleanSong = (v: unknown): Song | null => {
  const o = obj(v);
  if (typeof o.id !== 'string' || typeof o.uri !== 'string') return null;
  return {
    id: o.id,
    uri: o.uri,
    title: str(o.title, 'Unknown'),
    artist: str(o.artist),
    album: str(o.album),
    albumId: String(o.albumId ?? ''),
    genre: str(o.genre),
    durationMs: num(o.durationMs),
    folder: str(o.folder),
    dateAdded: num(o.dateAdded),
    mimeType: str(o.mimeType),
    size: num(o.size),
    artUri: typeof o.artUri === 'string' && o.artUri ? o.artUri : null,
    source: o.source === 'import' ? 'import' : 'library',
  };
};

const songs = (v: unknown): Song[] =>
  arr(v)
    .map(cleanSong)
    .filter((s): s is Song => s !== null);

// ── library ──

export interface LibraryData {
  /** Last MediaStore scan. */
  scanned: Song[];
  /** Files picked with the document picker. */
  imported: Song[];
  scannedAt: number | null;
}

export const libraryStore = createJsonStore<LibraryData>(
  StorageKeys.AudioStudioLibrary,
  raw => {
    const o = obj(raw);
    return {
      scanned: songs(o.scanned),
      imported: songs(o.imported),
      scannedAt: typeof o.scannedAt === 'number' ? o.scannedAt : null,
    };
  },
);

// ── likes, playlists, recently played ──

export interface CollectionsData {
  /** Song id → when it was liked. */
  liked: Record<string, number>;
  playlists: Playlist[];
  /** Newest first, at most RECENT_MAX. */
  recent: { id: string; at: number }[];
}

export const RECENT_MAX = 200;

const cleanPlaylist = (v: unknown): Playlist | null => {
  const o = obj(v);
  if (typeof o.id !== 'string') return null;
  return {
    id: o.id,
    name: str(o.name, 'Playlist').slice(0, 80),
    songIds: arr(o.songIds).filter((x): x is string => typeof x === 'string'),
    cover: typeof o.cover === 'string' && o.cover ? o.cover : null,
    createdAt: num(o.createdAt, Date.now()),
    updatedAt: num(o.updatedAt, Date.now()),
  };
};

export const collectionsStore = createJsonStore<CollectionsData>(
  StorageKeys.AudioStudioCollections,
  raw => {
    const o = obj(raw);
    const liked: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(o.liked)))
      if (typeof v === 'number') liked[k] = v;
    return {
      liked,
      playlists: arr(o.playlists)
        .map(cleanPlaylist)
        .filter((p): p is Playlist => p !== null),
      recent: arr(o.recent)
        .map(obj)
        .filter(r => typeof r.id === 'string' && typeof r.at === 'number')
        .map(r => ({ id: r.id as string, at: r.at as number }))
        .slice(0, RECENT_MAX),
    };
  },
);

// ── DSP settings, presets, player preferences ──

export interface StudioData {
  settings: StudioSettings;
  /** Selected preset (built-in or custom) or null after manual changes. */
  presetId: string | null;
  /** User presets plus edited copies of built-ins (same id = override). */
  presets: SpatialPreset[];
  eqProfiles: EqProfile[];
  eqProfileId: string | null;
  speed: number;
  crossfadeMs: number;
}

export const cleanSettings = (v: unknown): StudioSettings => {
  const o = obj(v);
  const d = DEFAULT_SETTINGS;
  const out = { ...d } as Record<string, unknown>;
  for (const key of Object.keys(d) as (keyof StudioSettings)[]) {
    const def = d[key];
    const val = o[key];
    if (Array.isArray(def)) {
      out[key] =
        Array.isArray(val) && val.length === def.length
          ? val.map((x, i) => num(x, def[i] as number))
          : def;
    } else if (typeof def === typeof val) out[key] = val;
  }
  return out as unknown as StudioSettings;
};

export const studioStore = createJsonStore<StudioData>(
  StorageKeys.AudioStudioSettings,
  raw => {
    const o = obj(raw);
    return {
      settings: cleanSettings(o.settings),
      presetId: typeof o.presetId === 'string' ? o.presetId : 'ultra8d',
      presets: arr(o.presets)
        .map(obj)
        .filter(p => typeof p.id === 'string' && typeof p.name === 'string')
        .map(p => ({
          id: p.id as string,
          name: (p.name as string).slice(0, 40),
          builtIn: p.builtIn === true,
          settings: obj(p.settings) as Partial<StudioSettings>,
        })),
      eqProfiles: arr(o.eqProfiles)
        .map(obj)
        .filter(p => typeof p.id === 'string' && Array.isArray(p.eq))
        .map(p => ({
          id: p.id as string,
          name: str(p.name, 'Custom').slice(0, 40),
          builtIn: false,
          preamp: num(p.preamp),
          eq: (p.eq as unknown[]).slice(0, 10).map(x => num(x)),
          bass: num(p.bass),
          treble: num(p.treble),
          vocal: num(p.vocal),
        })),
      eqProfileId: typeof o.eqProfileId === 'string' ? o.eqProfileId : 'flat',
      speed: Math.min(2, Math.max(0.5, num(o.speed, 1))),
      crossfadeMs: Math.min(12000, Math.max(0, num(o.crossfadeMs, 0))),
    };
  },
);

// ── the queue to restore after a restart ──

export interface SessionData {
  queue: string[];
  index: number;
  positionMs: number;
}

export const sessionStore = createJsonStore<SessionData>(
  StorageKeys.AudioStudioSession,
  raw => {
    const o = obj(raw);
    return {
      queue: arr(o.queue).filter((x): x is string => typeof x === 'string'),
      index: Math.max(0, num(o.index)),
      positionMs: Math.max(0, num(o.positionMs)),
    };
  },
);
