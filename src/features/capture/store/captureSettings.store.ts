import { storage, StorageKeys } from '@/store/mmkv';
import {
  isFloatingAction,
  isOcrMode,
  isSpeechLanguage,
  type CaptureSettings,
  type PaginationSettings,
  type TranslateSettings,
  type ReadingSettings,
  type SpeechSettings,
} from '../capture.types';

export const BUBBLE_SIZE = { min: 40, max: 80, step: 4 } as const;
export const BUBBLE_OPACITY = { min: 0.3, max: 1, step: 0.05 } as const;
export const SPEECH_RATE = { min: 0.5, max: 2, step: 0.1 } as const;
export const SPEECH_PITCH = { min: 0.5, max: 2, step: 0.1 } as const;
export const MAX_SECTIONS = { min: 1, max: 100, step: 1 } as const;
export const MAX_NO_NEW_TEXT = { min: 1, max: 5, step: 1 } as const;
export const PAGE_LOAD_DELAY = { min: 500, max: 5000, step: 250 } as const;
export const VERIFY_TIMEOUT = { min: 2000, max: 20000, step: 1000 } as const;
export const MAX_PAGES = { min: 1, max: 200, step: 1 } as const;

export const DEFAULT_TRANSLATE_PROMPT =
  'Translate the text naturally into {target}. Keep names, numbers, prices and URLs unchanged. Keep paragraph breaks. Output only the translation.';
export const MAX_TRANSLATE_PROMPT = 1000;
export const DEFAULT_TRANSLATE_MODEL = 'gemini-flash-latest';

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
  enabled: false,
  target: 'hi',
  source: 'auto',
  prompt: DEFAULT_TRANSLATE_PROMPT,
  model: DEFAULT_TRANSLATE_MODEL,
  thinkingLevel: 'low',
  projectNumber: '',
};

export const DEFAULT_PAGINATION_SETTINGS: PaginationSettings = {
  pageLoadDelayMs: 1250,
  verifyTimeoutMs: 6000,
  maxPages: 50,
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  language: 'en',
  voiceName: '',
  rate: 1,
  pitch: 1,
  switchByScript: true,
  preferGoogle: true,
  copyBeforeSpeaking: false,
  stopOnLeave: true,
  resumeAfterInterruption: true,
};

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  autoScroll: true,
  maxSections: 30,
  maxNoNewText: 2,
  manualFallback: true,
};

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  ocrMode: 'mixed',
  action: 'copy',
  autoCopy: true,
  saveHistory: true,
  bubbleSizeDp: 56,
  bubbleOpacity: 0.9,
  speech: DEFAULT_SPEECH_SETTINGS,
  reading: DEFAULT_READING_SETTINGS,
  pagination: DEFAULT_PAGINATION_SETTINGS,
  translate: DEFAULT_TRANSLATE_SETTINGS,
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

function record(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Rounds to one decimal so slider steps don't accumulate float noise. */
function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function sanitizeSpeechSettings(raw: unknown): SpeechSettings {
  const d = DEFAULT_SPEECH_SETTINGS;
  const r = record(raw);
  return {
    language: isSpeechLanguage(r.language) ? r.language : d.language,
    voiceName: typeof r.voiceName === 'string' ? r.voiceName : d.voiceName,
    rate: tenth(clamp(r.rate, SPEECH_RATE.min, SPEECH_RATE.max, d.rate)),
    pitch: tenth(clamp(r.pitch, SPEECH_PITCH.min, SPEECH_PITCH.max, d.pitch)),
    switchByScript: bool(r.switchByScript, d.switchByScript),
    preferGoogle: bool(r.preferGoogle, d.preferGoogle),
    copyBeforeSpeaking: bool(r.copyBeforeSpeaking, d.copyBeforeSpeaking),
    stopOnLeave: bool(r.stopOnLeave, d.stopOnLeave),
    resumeAfterInterruption: bool(
      r.resumeAfterInterruption,
      d.resumeAfterInterruption,
    ),
  };
}

export function sanitizeReadingSettings(raw: unknown): ReadingSettings {
  const d = DEFAULT_READING_SETTINGS;
  const r = record(raw);
  return {
    autoScroll: bool(r.autoScroll, d.autoScroll),
    maxSections: Math.round(
      clamp(r.maxSections, MAX_SECTIONS.min, MAX_SECTIONS.max, d.maxSections),
    ),
    maxNoNewText: Math.round(
      clamp(
        r.maxNoNewText,
        MAX_NO_NEW_TEXT.min,
        MAX_NO_NEW_TEXT.max,
        d.maxNoNewText,
      ),
    ),
    manualFallback: bool(r.manualFallback, d.manualFallback),
  };
}

export function sanitizePaginationSettings(raw: unknown): PaginationSettings {
  const d = DEFAULT_PAGINATION_SETTINGS;
  const r = record(raw);
  return {
    pageLoadDelayMs: Math.round(
      clamp(
        r.pageLoadDelayMs,
        PAGE_LOAD_DELAY.min,
        PAGE_LOAD_DELAY.max,
        d.pageLoadDelayMs,
      ),
    ),
    verifyTimeoutMs: Math.round(
      clamp(
        r.verifyTimeoutMs,
        VERIFY_TIMEOUT.min,
        VERIFY_TIMEOUT.max,
        d.verifyTimeoutMs,
      ),
    ),
    maxPages: Math.round(
      clamp(r.maxPages, MAX_PAGES.min, MAX_PAGES.max, d.maxPages),
    ),
  };
}

export function sanitizeTranslateSettings(raw: unknown): TranslateSettings {
  const d = DEFAULT_TRANSLATE_SETTINGS;
  const r = record(raw);
  const model =
    typeof r.model === 'string' && /^[A-Za-z0-9._-]{3,64}$/.test(r.model.trim())
      ? r.model.trim()
      : d.model;
  return {
    // "consent" was the earlier name of the switch.
    enabled: bool(r.enabled, bool(r.consent, d.enabled)),
    target: isSpeechLanguage(r.target) ? r.target : d.target,
    source:
      r.source === 'auto' || isSpeechLanguage(r.source) ? r.source : d.source,
    prompt:
      typeof r.prompt === 'string' && r.prompt.trim().length > 0
        ? r.prompt.slice(0, MAX_TRANSLATE_PROMPT)
        : d.prompt,
    model,
    thinkingLevel:
      r.thinkingLevel === 'low' ||
      r.thinkingLevel === 'medium' ||
      r.thinkingLevel === 'high'
        ? r.thinkingLevel
        : d.thinkingLevel,
    projectNumber:
      typeof r.projectNumber === 'string' &&
      /^\d{0,20}$/.test(r.projectNumber.trim())
        ? r.projectNumber.trim()
        : d.projectNumber,
  };
}

/** Field-by-field validation: one bad value never resets the others. */
export function sanitizeCaptureSettings(raw: unknown): CaptureSettings {
  const d = DEFAULT_CAPTURE_SETTINGS;
  const r = record(raw);
  // "speak_translate" was briefly a fifth action; translation is now a switch.
  const legacyTranslate = r.action === 'speak_translate';
  const translate = sanitizeTranslateSettings(r.translate);
  return {
    ocrMode: isOcrMode(r.ocrMode) ? r.ocrMode : d.ocrMode,
    action: legacyTranslate
      ? 'speak'
      : isFloatingAction(r.action)
      ? r.action
      : d.action,
    autoCopy: bool(r.autoCopy, d.autoCopy),
    saveHistory: bool(r.saveHistory, d.saveHistory),
    bubbleSizeDp: Math.round(
      clamp(r.bubbleSizeDp, BUBBLE_SIZE.min, BUBBLE_SIZE.max, d.bubbleSizeDp),
    ),
    bubbleOpacity: clamp(
      r.bubbleOpacity,
      BUBBLE_OPACITY.min,
      BUBBLE_OPACITY.max,
      d.bubbleOpacity,
    ),
    speech: sanitizeSpeechSettings(r.speech),
    reading: sanitizeReadingSettings(r.reading),
    pagination: sanitizePaginationSettings(r.pagination),
    translate: legacyTranslate ? { ...translate, enabled: true } : translate,
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
  updateSpeech(patch: Partial<SpeechSettings>): CaptureSettings {
    const current = captureSettingsStore.read();
    return captureSettingsStore.update({
      speech: { ...current.speech, ...patch },
    });
  },
  updateReading(patch: Partial<ReadingSettings>): CaptureSettings {
    const current = captureSettingsStore.read();
    return captureSettingsStore.update({
      reading: { ...current.reading, ...patch },
    });
  },
  updateTranslate(patch: Partial<TranslateSettings>): CaptureSettings {
    const current = captureSettingsStore.read();
    return captureSettingsStore.update({
      translate: { ...current.translate, ...patch },
    });
  },
  updatePagination(patch: Partial<PaginationSettings>): CaptureSettings {
    const current = captureSettingsStore.read();
    return captureSettingsStore.update({
      pagination: { ...current.pagination, ...patch },
    });
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
