import { PermissionsAndroid, Platform } from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import { libraryStore, cleanSong } from '../store/stores';
import type { Song } from '../types';
import { audioNative } from './native.service';

/*
 * The music library: a MediaStore scan (needs READ_MEDIA_AUDIO) plus files
 * the user picks with the system picker (no permission needed; access is
 * persisted natively). Indexes (albums, artists, …) are derived on demand.
 */

const parseSongs = (json: string): Song[] => {
  try {
    const raw = JSON.parse(json) as unknown[];
    return Array.isArray(raw)
      ? raw.map(cleanSong).filter((s): s is Song => s !== null)
      : [];
  } catch {
    return [];
  }
};

export type ScanResult = 'ok' | 'denied' | 'blocked' | 'failed';

async function ensurePermission(): Promise<'granted' | 'denied' | 'blocked'> {
  if (Platform.OS !== 'android') return 'granted';
  const perm =
    Number(Platform.Version) >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
  if (await PermissionsAndroid.check(perm)) return 'granted';
  const r = await PermissionsAndroid.request(perm);
  if (r === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  return r === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ? 'blocked'
    : 'denied';
}

export const libraryService = {
  /** All songs: scanned + imported, imported ones not duplicated. */
  all(): Song[] {
    const { scanned, imported } = libraryStore.read();
    return [...scanned, ...imported];
  },

  async scan(): Promise<ScanResult> {
    const perm = await ensurePermission();
    if (perm !== 'granted') return perm;
    try {
      const scanned = parseSongs(await audioNative.scanLibrary());
      libraryStore.update(d => ({ ...d, scanned, scannedAt: Date.now() }));
      return 'ok';
    } catch {
      return 'failed';
    }
  },

  /** Lets the user pick audio files anywhere (Downloads, SD card, Drive…). */
  async importFiles(): Promise<number> {
    try {
      const files = await pick({
        type: [types.audio],
        allowMultiSelection: true,
        mode: 'open',
        requestLongTermAccess: true,
      });
      const uris = files.filter(f => !f.error).map(f => f.uri);
      const added = parseSongs(await audioNative.importFiles(uris));
      libraryStore.update(d => {
        const known = new Set(d.imported.map(s => s.id));
        return {
          ...d,
          imported: [...d.imported, ...added.filter(s => !known.has(s.id))],
        };
      });
      return added.length;
    } catch (e) {
      if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED)
        return 0;
      throw e;
    }
  },

  removeImported(id: string): void {
    libraryStore.update(d => ({
      ...d,
      imported: d.imported.filter(s => s.id !== id),
    }));
  },
};

// ── derived views (pure; unit-tested) ──

export type SortKey = 'title' | 'artist' | 'album' | 'dateAdded' | 'duration';

const byText = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

export function sortSongs(songs: Song[], key: SortKey): Song[] {
  const list = [...songs];
  switch (key) {
    case 'artist':
      return list.sort(
        (a, b) => byText(a.artist, b.artist) || byText(a.title, b.title),
      );
    case 'album':
      return list.sort(
        (a, b) => byText(a.album, b.album) || byText(a.title, b.title),
      );
    case 'dateAdded':
      return list.sort((a, b) => b.dateAdded - a.dateAdded);
    case 'duration':
      return list.sort((a, b) => b.durationMs - a.durationMs);
    default:
      return list.sort((a, b) => byText(a.title, b.title));
  }
}

export function searchSongs(songs: Song[], query: string): Song[] {
  const q = query.trim().toLowerCase();
  if (!q) return songs;
  const words = q.split(/\s+/);
  return songs.filter(s => {
    const hay =
      `${s.title} ${s.artist} ${s.album} ${s.genre} ${s.folder}`.toLowerCase();
    return words.every(w => hay.includes(w));
  });
}

export interface Group {
  key: string;
  title: string;
  subtitle: string;
  artUri: string | null;
  songs: Song[];
}

export type GroupBy = 'album' | 'artist' | 'genre' | 'folder';

export function groupSongs(
  songs: Song[],
  by: GroupBy,
  unknown: string,
): Group[] {
  const map = new Map<string, Group>();
  for (const s of songs) {
    const raw =
      by === 'album'
        ? s.album
        : by === 'artist'
        ? s.artist
        : by === 'genre'
        ? s.genre
        : s.folder;
    const title = raw.trim() || unknown;
    const key =
      by === 'album' ? `${title}\u0000${s.albumId}` : title.toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        title,
        subtitle: by === 'album' ? s.artist : '',
        artUri: s.artUri,
        songs: [],
      };
      map.set(key, g);
    }
    g.songs.push(s);
    if (!g.artUri && s.artUri) g.artUri = s.artUri;
  }
  return [...map.values()]
    .map(g => ({
      ...g,
      songs: by === 'album' ? g.songs : sortSongs(g.songs, 'title'),
    }))
    .sort((a, b) => byText(a.title, b.title));
}

export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};
