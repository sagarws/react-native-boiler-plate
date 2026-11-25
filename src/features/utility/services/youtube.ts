import type {
  ActiveDownload,
  DownloadEntry,
  DownloadEvent,
  DownloadKind,
  DownloadOption,
  DownloadPhase,
  VideoDetails,
} from '../youtube.types';

/**
 * Pure helpers for the YouTube Downloader: link checks and validation of the
 * JSON the native module sends. Bad fields fall back to safe defaults; bad
 * records are dropped.
 */

type R = Record<string, unknown>;
const obj = (v: unknown): R =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as R) : {};
const str = (v: unknown, max = 500) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
const kind = (v: unknown): DownloadKind => (v === 'audio' ? 'audio' : 'video');
const PHASES: readonly DownloadPhase[] = ['fetching', 'downloading', 'merging'];
const phase = (v: unknown): DownloadPhase =>
  PHASES.includes(v as DownloadPhase) ? (v as DownloadPhase) : 'fetching';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
]);
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The 11-character video id from a YouTube link (watch, youtu.be, shorts,
 * live, embed), or null when the text is not a YouTube video link.
 */
export function youTubeVideoId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null | undefined;
  if (host === 'youtu.be') id = parts[0];
  else if (parts[0] === 'watch') id = url.searchParams.get('v');
  else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? ''))
    id = parts[1];
  return id && VIDEO_ID.test(id) ? id : null;
}

/** The canonical watch URL for a link, or null when it isn't a video link. */
export function canonicalYouTubeUrl(input: string): string | null {
  const id = youTubeVideoId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function parseOption(v: unknown): DownloadOption | null {
  const r = obj(v);
  const id = str(r.id, 64);
  const label = str(r.label, 40);
  if (!id || !label) return null;
  return {
    id,
    kind: kind(r.kind),
    label,
    height: num(r.height),
    fps: num(r.fps),
    ext: str(r.ext, 8),
    codec: str(r.codec, 16),
    bitrateKbps: num(r.bitrateKbps),
    sizeBytes: num(r.sizeBytes),
  };
}

const options = (v: unknown) =>
  Array.isArray(v)
    ? v.map(parseOption).filter((o): o is DownloadOption => o !== null)
    : [];

export function parseVideoDetails(json: string): VideoDetails | null {
  let r: R;
  try {
    r = obj(JSON.parse(json));
  } catch {
    return null;
  }
  const id = str(r.id, 32);
  if (!id) return null;
  const details: VideoDetails = {
    id,
    url: str(r.url, 200),
    title: str(r.title, 300),
    author: str(r.author, 200),
    durationSec: num(r.durationSec),
    thumbnail: str(r.thumbnail, 1000),
    video: options(r.video),
    audio: options(r.audio),
  };
  return details.video.length || details.audio.length ? details : null;
}

export function parseActive(v: unknown): ActiveDownload | null {
  let r: R;
  try {
    r = typeof v === 'string' ? (v ? obj(JSON.parse(v)) : {}) : obj(v);
  } catch {
    return null;
  }
  const id = str(r.id, 64);
  if (!id) return null;
  return {
    id,
    title: str(r.title, 300),
    label: str(r.label, 40),
    phase: phase(r.phase),
    fraction: Math.min(1, num(r.fraction)),
  };
}

export function parseEntry(v: unknown): DownloadEntry | null {
  const r = obj(v);
  const id = str(r.id, 64);
  if (!id) return null;
  return {
    id,
    title: str(r.title, 300),
    author: str(r.author, 200),
    kind: kind(r.kind),
    label: str(r.label, 40),
    name: str(r.name, 300),
    mime: str(r.mime, 40),
    sizeBytes: num(r.sizeBytes),
    durationSec: num(r.durationSec),
    createdAt: num(r.createdAt),
  };
}

export function parseEntries(json: string): DownloadEntry[] {
  try {
    const arr: unknown = JSON.parse(json);
    return Array.isArray(arr)
      ? arr
          .map(parseEntry)
          .filter((e): e is DownloadEntry => e !== null)
          .sort((a, b) => b.createdAt - a.createdAt)
      : [];
  } catch {
    return [];
  }
}

/** A native `YouTubeDownloadEvent` {type, body: JSON} → typed event, or null. */
export function parseDownloadEvent(
  type: unknown,
  body: unknown,
): DownloadEvent | null {
  let r: R;
  try {
    r = obj(typeof body === 'string' ? JSON.parse(body) : body);
  } catch {
    return null;
  }
  switch (type) {
    case 'progress': {
      const active = parseActive(r);
      return active ? { type, active } : null;
    }
    case 'completed': {
      const entry = parseEntry(r.entry);
      return entry ? { type, entry } : null;
    }
    case 'failed':
      return {
        type,
        id: str(r.id, 64),
        code: str(r.code, 40) || 'download_failed',
      };
    case 'cancelled':
      return { type, id: str(r.id, 64) };
    default:
      return null;
  }
}

/** Error codes with their own message; anything else shows the generic one. */
export const KNOWN_ERRORS = [
  'invalid_url',
  'network',
  'private',
  'age_restricted',
  'paid',
  'geo_blocked',
  'unavailable',
  'live_unsupported',
  'rate_limited',
  'no_streams',
  'link_expired',
  'storage_full',
  'busy',
  'unavailable_platform',
] as const;

export function errorKey(code: string): string {
  return (KNOWN_ERRORS as readonly string[]).includes(code)
    ? `utility.yt.error_${code}`
    : 'utility.yt.error_generic';
}
