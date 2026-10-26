import { storage, StorageKeys } from '@/store/mmkv';
import { isOcrMode, type CaptureSettings } from '../capture.types';

export const BUBBLE_SIZE = { min: 40, max: 80, step: 4 } as const;
export const BUBBLE_OPACITY = { min: 0.3, max: 1, step: 0.05 } as const;

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  ocrMode: 'mixed',
  autoCopy: true,
  saveHistory: true,
  bubbleSizeDp: 56,
  bubbleOpacity: 0.9,
};

function clamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/** Field-by-field validation: one bad value never resets the others. */
export function sanitizeCaptureSettings(raw: unknown): CaptureSettings {
  const d = DEFAULT_CAPTURE_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    ocrMode: isOcrMode(r.ocrMode) ? r.ocrMode : d.ocrMode,
    autoCopy: typeof r.autoCopy === 'boolean' ? r.autoCopy : d.autoCopy,
    saveHistory:
      typeof r.saveHistory === 'boolean' ? r.saveHistory : d.saveHistory,
    bubbleSizeDp: Math.round(
      clamp(r.bubbleSizeDp, BUBBLE_SIZE.min, BUBBLE_SIZE.max, d.bubbleSizeDp),
    ),
    bubbleOpacity: clamp(
      r.bubbleOpacity,
      BUBBLE_OPACITY.min,
      BUBBLE_OPACITY.max,
      d.bubbleOpacity,
    ),
  };
}

function load(): CaptureSettings {
  const raw = storage.getString(StorageKeys.CaptureSettings);
  if (!raw) return DEFAULT_CAPTURE_SETTINGS;
  try {
    return sanitizeCaptureSettings(JSON.parse(raw));
  } catch {
    // Corrupt JSON: fall back to defaults rather than crash on launch.
    return DEFAULT_CAPTURE_SETTINGS;
  }
}

type Listener = (settings: CaptureSettings) => void;
const listeners = new Set<Listener>();
let cache: CaptureSettings | null = null;

/** Capture settings: synchronous reads, persisted writes, change listeners. */
export const captureSettingsStore = {
  read(): CaptureSettings {
    if (!cache) cache = load();
    return cache;
  },
  update(patch: Partial<CaptureSettings>): CaptureSettings {
    const next = sanitizeCaptureSettings({
      ...captureSettingsStore.read(),
      ...patch,
    });
    cache = next;
    storage.set(StorageKeys.CaptureSettings, JSON.stringify(next));
    for (const listener of listeners) listener(next);
    return next;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Test hook: forget the in-memory copy so the next read hits storage. */
  resetCacheForTest(): void {
    cache = null;
  },
};
