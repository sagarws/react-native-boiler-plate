import {
  AUDIO_PRESETS,
  AUDIO_SOURCES,
  MAX_SEGMENT_MINUTES,
  MIN_SEGMENT_MINUTES,
  RECORDER_MODES,
  VIDEO_PRESETS,
  type DirectoryStatus,
  type LibraryFilter,
  type Recording,
  type RecorderConfig,
  type RecorderStatus,
  type RecordingSegment,
  type RecordingStateId,
  type VideoCapabilities,
  type VideoPlanInfo,
} from '../recorder.types';

/**
 * Pure Screen Recorder logic: validating native JSON, library filtering and
 * the numbers the screens show. No native calls here (see recorder.service).
 */

type R = Record<string, unknown>;
const obj = (v: unknown): R => (v && typeof v === 'object' ? (v as R) : {});
const num = (v: unknown, d = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
const str = (v: unknown, max = 300) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;

export const DEFAULT_RECORDER_CONFIG: RecorderConfig = {
  bubbleEnabled: false,
  mode: 'screenshot',
  longPressMenu: true,
  showControls: true,
  previewSeconds: 5,
  autoSaveScreenshot: false,
  keepCaptureSession: true,
  videoPreset: 'medium',
  customVideo: { height: 720, fps: 30, bitrate: 4_000_000 },
  audioSource: 'system',
  audioPreset: 'standard',
  customAudio: { sampleRate: 44_100, bitrate: 128_000, channels: 2 },
  segmentEnabled: true,
  segmentMinutes: 5,
  autoMerge: true,
  keepSegments: false,
  storageWarningMb: 500,
  keepScreenOn: false,
};

export function clampSegmentMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RECORDER_CONFIG.segmentMinutes;
  return Math.min(
    MAX_SEGMENT_MINUTES,
    Math.max(MIN_SEGMENT_MINUTES, Math.round(value)),
  );
}

/** Parses a typed custom interval; null when it isn't a whole number in range. */
export function parseSegmentMinutes(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= MIN_SEGMENT_MINUTES && n <= MAX_SEGMENT_MINUTES ? n : null;
}

export function parseConfig(json: string): RecorderConfig {
  let r: R;
  try {
    r = obj(JSON.parse(json));
  } catch {
    return DEFAULT_RECORDER_CONFIG;
  }
  const d = DEFAULT_RECORDER_CONFIG;
  const cv = obj(r.customVideo);
  const ca = obj(r.customAudio);
  return {
    bubbleEnabled: bool(r.bubbleEnabled, d.bubbleEnabled),
    mode: oneOf(r.mode, RECORDER_MODES, d.mode),
    longPressMenu: bool(r.longPressMenu, d.longPressMenu),
    showControls: bool(r.showControls, d.showControls),
    previewSeconds: num(r.previewSeconds, d.previewSeconds),
    autoSaveScreenshot: bool(r.autoSaveScreenshot, d.autoSaveScreenshot),
    keepCaptureSession: bool(r.keepCaptureSession, d.keepCaptureSession),
    videoPreset: oneOf(r.videoPreset, VIDEO_PRESETS, d.videoPreset),
    customVideo: {
      height: num(cv.height, d.customVideo.height),
      fps: num(cv.fps, d.customVideo.fps),
      bitrate: num(cv.bitrate, d.customVideo.bitrate),
    },
    audioSource: oneOf(r.audioSource, AUDIO_SOURCES, d.audioSource),
    audioPreset: oneOf(r.audioPreset, AUDIO_PRESETS, d.audioPreset),
    customAudio: {
      sampleRate: num(ca.sampleRate, d.customAudio.sampleRate),
      bitrate: num(ca.bitrate, d.customAudio.bitrate),
      channels: num(ca.channels, d.customAudio.channels),
    },
    segmentEnabled: bool(r.segmentEnabled, d.segmentEnabled),
    segmentMinutes: clampSegmentMinutes(
      num(r.segmentMinutes, d.segmentMinutes),
    ),
    autoMerge: bool(r.autoMerge, d.autoMerge),
    keepSegments: bool(r.keepSegments, d.keepSegments),
    storageWarningMb: num(r.storageWarningMb, d.storageWarningMb),
    keepScreenOn: bool(r.keepScreenOn, d.keepScreenOn),
  };
}

const STATES: readonly RecordingStateId[] = [
  'idle',
  'requesting_permission',
  'preparing',
  'recording',
  'paused',
  'finalizing_segment',
  'starting_next_segment',
  'stopping',
  'merging',
  'verifying_output',
  'completed',
  'interrupted',
  'failed',
];

export const UNSUPPORTED_STATUS: RecorderStatus = {
  supported: false,
  sdk: 0,
  overlayPermission: false,
  micPermission: false,
  notifications: false,
  systemAudioSupported: false,
  bubbleShown: false,
  state: 'idle',
  sessionMode: null,
  elapsedMs: 0,
  segment: 1,
  content: '',
  captureHeld: false,
  mergeProgress: 0,
};

/** Merges a status/state JSON over [base] (state events carry a subset). */
export function parseStatus(
  json: string | R,
  base: RecorderStatus = UNSUPPORTED_STATUS,
): RecorderStatus {
  let r: R;
  try {
    r = typeof json === 'string' ? obj(JSON.parse(json)) : json;
  } catch {
    return base;
  }
  const has = (k: string) => k in r;
  return {
    supported: has('supported') ? bool(r.supported, false) : base.supported,
    sdk: has('sdk') ? num(r.sdk) : base.sdk,
    overlayPermission: has('overlayPermission')
      ? bool(r.overlayPermission, false)
      : base.overlayPermission,
    micPermission: has('micPermission')
      ? bool(r.micPermission, false)
      : base.micPermission,
    notifications: has('notifications')
      ? bool(r.notifications, false)
      : base.notifications,
    systemAudioSupported: has('systemAudioSupported')
      ? bool(r.systemAudioSupported, false)
      : base.systemAudioSupported,
    bubbleShown: has('bubbleShown')
      ? bool(r.bubbleShown, false)
      : base.bubbleShown,
    state: has('state') ? oneOf(r.state, STATES, 'idle') : base.state,
    sessionMode: has('sessionMode')
      ? (RECORDER_MODES as readonly string[]).includes(r.sessionMode as string)
        ? (r.sessionMode as RecorderStatus['sessionMode'])
        : null
      : base.sessionMode,
    elapsedMs: has('elapsedMs') ? num(r.elapsedMs) : base.elapsedMs,
    segment: has('segment') ? Math.max(1, num(r.segment, 1)) : base.segment,
    content: has('content') ? str(r.content, 120) : base.content,
    captureHeld: has('captureHeld')
      ? bool(r.captureHeld, false)
      : base.captureHeld,
    mergeProgress: has('mergeProgress')
      ? Math.min(1, Math.max(0, num(r.mergeProgress)))
      : base.mergeProgress,
  };
}

/** Media is being captured: Stop / Pause apply. */
export const isCapturing = (s: RecordingStateId) =>
  s === 'recording' ||
  s === 'paused' ||
  s === 'finalizing_segment' ||
  s === 'starting_next_segment';

/** A session holds files open (no second session, no delete of it). */
export const isBusy = (s: RecordingStateId) =>
  s !== 'idle' && s !== 'completed' && s !== 'interrupted' && s !== 'failed';

const SEG_STATUS = ['writing', 'done', 'failed', 'deleted'] as const;
const REC_STATUS = [
  'recording',
  'processing',
  'completed',
  'unmerged',
  'interrupted',
  'failed',
] as const;

function parseSegment(v: unknown): RecordingSegment | null {
  const r = obj(v);
  if (typeof r.index !== 'number') return null;
  return {
    index: num(r.index),
    name: str(r.name, 200),
    startUs: num(r.startUs),
    durationUs: num(r.durationUs),
    sizeBytes: Math.max(0, num(r.sizeBytes)),
    status: oneOf(r.status, SEG_STATUS, 'failed'),
  };
}

export function parseRecording(v: unknown): Recording | null {
  const r = obj(v);
  if (typeof r.id !== 'string' || !r.id) return null;
  const type = oneOf(
    r.type,
    ['screenshot', 'video', 'audio'] as const,
    'video',
  );
  return {
    id: r.id,
    type,
    name: str(r.name, 200) || r.id,
    uri: str(r.uri, 2000),
    createdAt: num(r.createdAt),
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : null,
    durationMs: Math.max(0, num(r.durationMs)),
    sizeBytes: Math.max(0, num(r.sizeBytes)),
    width: num(r.width),
    height: num(r.height),
    fps: num(r.fps),
    audio: oneOf(
      r.audio,
      ['none', 'system', 'mic', 'system_mic'] as const,
      'none',
    ),
    status: oneOf(r.status, REC_STATUS, 'failed'),
    error: str(r.error, 60),
    segmentMinutes: Math.max(0, num(r.segmentMinutes)),
    keepSegments: bool(r.keepSegments, false),
    thumb: str(r.thumb, 2000),
    segments: Array.isArray(r.segments)
      ? r.segments
          .map(parseSegment)
          .filter((s): s is RecordingSegment => s !== null)
          .sort((a, b) => a.index - b.index)
      : [],
  };
}

export function parseRecordings(json: string): Recording[] {
  try {
    const arr: unknown = JSON.parse(json);
    return Array.isArray(arr)
      ? arr
          .map(parseRecording)
          .filter((x): x is Recording => x !== null)
          .sort((a, b) => b.createdAt - a.createdAt)
      : [];
  } catch {
    return [];
  }
}

export function parseDirectories(
  json: string,
): Partial<Record<string, DirectoryStatus>> {
  try {
    const r = obj(JSON.parse(json));
    const out: Partial<Record<string, DirectoryStatus>> = {};
    for (const [k, v] of Object.entries(r)) out[k] = parseDirectory(v);
    return out;
  } catch {
    return {};
  }
}

export function parseDirectory(v: unknown): DirectoryStatus {
  const r = obj(v);
  return {
    label: str(r.label, 300),
    custom: bool(r.custom, false),
    accessible: bool(r.accessible, false),
    freeBytes: Math.max(0, num(r.freeBytes)),
  };
}

function parsePlan(v: unknown): VideoPlanInfo {
  const r = obj(v);
  return {
    width: num(r.width),
    height: num(r.height),
    fps: num(r.fps),
    bitrate: num(r.bitrate),
  };
}

export function parseCapabilities(json: string): VideoCapabilities | null {
  try {
    const r = obj(JSON.parse(json));
    const p = obj(r.presets);
    return {
      screenWidth: num(r.screenWidth),
      screenHeight: num(r.screenHeight),
      encoder: str(r.encoder, 120),
      presets: {
        low: parsePlan(p.low),
        medium: parsePlan(p.medium),
        high: parsePlan(p.high),
        custom: parsePlan(p.custom),
      },
    };
  } catch {
    return null;
  }
}

// ── Library ──

/** Which library tab an entry belongs to (besides All). */
export function matchesFilter(rec: Recording, filter: LibraryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'screenshots':
      return rec.type === 'screenshot';
    case 'videos':
      return rec.type === 'video' && isFinished(rec);
    case 'audio':
      return rec.type === 'audio' && isFinished(rec);
    case 'processing':
      return rec.status === 'recording' || rec.status === 'processing';
    case 'interrupted':
      return rec.status === 'interrupted';
    case 'failed':
      return rec.status === 'failed';
  }
}

/** Completed with a verified file, or kept as parts awaiting a merge. */
export const isFinished = (rec: Recording) =>
  rec.status === 'completed' || rec.status === 'unmerged';

export const filterRecordings = (list: Recording[], filter: LibraryFilter) =>
  list.filter(r => matchesFilter(r, filter));

/** Segments that can still be merged (finalized and not deleted). */
export const mergeableSegments = (rec: Recording) =>
  rec.segments.filter(s => s.status === 'done');

export const canMerge = (rec: Recording) =>
  rec.type !== 'screenshot' &&
  rec.status !== 'recording' &&
  rec.status !== 'processing' &&
  mergeableSegments(rec).length > 0;

export const statusTone = (r: Recording) =>
  r.status === 'completed'
    ? 'success'
    : r.status === 'failed'
    ? 'error'
    : r.status === 'interrupted' || r.status === 'unmerged'
    ? 'warning'
    : 'primary';

/** Has a playable final file (never an incomplete temporary one). */
export const canPlay = (rec: Recording) =>
  rec.status === 'completed' && rec.uri.length > 0;

/** Total of the segment durations — the length of a not-yet-merged session. */
export const segmentsDurationMs = (rec: Recording) =>
  Math.round(
    rec.segments
      .filter(s => s.status !== 'failed')
      .reduce((sum, s) => sum + s.durationUs, 0) / 1000,
  );

export const displayDurationMs = (rec: Recording) =>
  rec.durationMs > 0 ? rec.durationMs : segmentsDurationMs(rec);

// ── Formatting ──

export function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Resolution label like "720p" from a short side. */
export const resolutionLabel = (w: number, h: number) =>
  w > 0 && h > 0 ? `${Math.min(w, h)}p` : '';

export const AUDIO_BITRATES: Record<string, number> = {
  low: 64_000,
  standard: 128_000,
  high: 192_000,
};

export function audioBitrate(config: RecorderConfig): number {
  return config.audioPreset === 'custom'
    ? config.customAudio.bitrate
    : AUDIO_BITRATES[config.audioPreset] ?? 128_000;
}

/** Approximate storage per hour of screen + audio recording, bytes. */
export function estimateBytesPerHour(
  videoBitrate: number,
  audioBitrateBps: number,
): number {
  return (
    ((Math.max(0, videoBitrate) + Math.max(0, audioBitrateBps)) * 3600) / 8
  );
}
