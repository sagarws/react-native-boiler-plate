/**
 * Which recogniser(s) the floating button runs. `mixed` is Hindi + English
 * (its id predates Gujarati support and is kept for stored settings).
 * English: ML Kit Latin · Hindi: ML Kit Devanagari · Gujarati: Tesseract.
 */
export type OcrMode =
  | 'english'
  | 'hindi'
  | 'gujarati'
  | 'mixed'
  | 'gujarati_english'
  | 'hindi_gujarati'
  | 'all';

export const OCR_MODES: readonly OcrMode[] = [
  'english',
  'hindi',
  'gujarati',
  'mixed',
  'gujarati_english',
  'hindi_gujarati',
  'all',
];

/** Scripts a mode reads — used to warn when the speech voice cannot read them. */
export const OCR_MODE_SCRIPTS: Record<OcrMode, readonly SpeechLanguage[]> = {
  english: ['en'],
  hindi: ['hi'],
  gujarati: ['gu'],
  mixed: ['hi', 'en'],
  gujarati_english: ['gu', 'en'],
  hindi_gujarati: ['hi', 'gu'],
  all: ['hi', 'gu', 'en'],
};

/** What a tap on the floating button does. */
export type FloatingAction =
  | 'copy'
  | 'speak'
  | 'speak_scroll'
  | 'speak_pagination';

export const FLOATING_ACTIONS: readonly FloatingAction[] = [
  'copy',
  'speak',
  'speak_scroll',
  'speak_pagination',
];

export function isFloatingAction(value: unknown): value is FloatingAction {
  return (
    typeof value === 'string' &&
    (FLOATING_ACTIONS as readonly string[]).includes(value)
  );
}

/** Speech language — independent of the OCR mode. */
export type SpeechLanguage = 'en' | 'hi' | 'gu';

export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = ['en', 'hi', 'gu'];

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return (
    typeof value === 'string' &&
    (SPEECH_LANGUAGES as readonly string[]).includes(value)
  );
}

export interface SpeechSettings {
  language: SpeechLanguage;
  /** Installed voice name, or '' for the language's default voice. */
  voiceName: string;
  rate: number;
  pitch: number;
  /** Read each sentence with a voice for its script when one is installed. */
  switchByScript: boolean;
  preferGoogle: boolean;
  copyBeforeSpeaking: boolean;
  /** In-app reading stops when you leave the screen; overlay reading stops when the screen turns off. */
  stopOnLeave: boolean;
  resumeAfterInterruption: boolean;
}

export type ThinkingLevel = 'low' | 'medium' | 'high';

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'low',
  'medium',
  'high',
];

/**
 * "Apply translation" (Google Gemini, user's own key — not stored here).
 * When enabled, every mode works on the translation.
 */
export interface TranslateSettings {
  /** Apply translation — also the user's consent to send extracted text to Gemini. */
  enabled: boolean;
  target: SpeechLanguage;
  source: 'auto' | SpeechLanguage;
  /** Instructions; {target} and {source} are substituted. */
  prompt: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  /**
   * The user's Google Cloud project number, kept for reference. Not sent:
   * requests are billed to whichever project owns the API key.
   */
  projectNumber: string;
}

/**
 * "Refine text" (Google Gemini, same key/model/thinking as translation):
 * repairs OCR damage — broken words, cut-off letters in old books — before
 * the text is copied, translated or spoken.
 */
export interface RefineSettings {
  /** Refine text — also the user's consent to send extracted text to Gemini. */
  enabled: boolean;
  /** Instructions for the repair. */
  prompt: string;
}

export type AudioShareSource = 'app' | 'device';

/** Share audio with the Akshar Listen Chrome extension (same Wi-Fi). */
export interface AudioShareSettings {
  enabled: boolean;
  /** Akshar's voice only, or all phone audio (playback capture; Android 10+). */
  source: AudioShareSource;
}

/** Speak with pagination: timing and limits for page turns. */
export interface PaginationSettings {
  /** Wait after pressing Next before checking the page. */
  pageLoadDelayMs: number;
  /** Stop waiting for a new page after this long (never re-clicks). */
  verifyTimeoutMs: number;
  maxPages: number;
}

/** Where the pinned Next button is and whether it is still usable. */
export type TargetProblem =
  | 'none'
  | 'rotated'
  | 'resized'
  | 'density_changed'
  | 'out_of_bounds'
  | 'not_identifiable';

export interface PaginationTargetStatus {
  x: number;
  y: number;
  anchor: 'screen' | 'content';
  packageName: string;
  calibratedAt: number;
  /** A matching accessibility node was recorded (enables exact clicks). */
  hasNode: boolean;
  problem: TargetProblem;
}

export interface ReadingSettings {
  autoScroll: boolean;
  maxSections: number;
  maxNoNewText: number;
  manualFallback: boolean;
}

export function isOcrMode(value: unknown): value is OcrMode {
  return (
    typeof value === 'string' &&
    (OCR_MODES as readonly string[]).includes(value)
  );
}

/** One finished extraction, as produced by the native service. */
export interface OcrResult {
  id: string;
  text: string;
  mode: OcrMode;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Time spent in OCR, excluding the screen grab. */
  durationMs: number;
  lineCount: number;
  /** Refine text: the repaired text, when refinement ran. */
  refined?: string;
  /** Apply translation: the translated text and its languages. */
  translation?: string;
  targetLanguage?: string;
  sourceLanguage?: string;
}

/** User settings for capture; persisted in MMKV and mirrored to native. */
export interface CaptureSettings {
  ocrMode: OcrMode;
  action: FloatingAction;
  autoCopy: boolean;
  saveHistory: boolean;
  bubbleSizeDp: number;
  bubbleOpacity: number;
  speech: SpeechSettings;
  reading: ReadingSettings;
  pagination: PaginationSettings;
  translate: TranslateSettings;
  refine: RefineSettings;
  audioShare: AudioShareSettings;
}

export type LanguageStatus = 'available' | 'missing_data' | 'not_supported';

export interface VoiceInfo {
  name: string;
  language: string;
  locale: string;
  networkRequired: boolean;
  installed: boolean;
  quality: number;
}

/** Device text-to-speech capabilities, read from Android (never assumed). */
export interface SpeechInfo {
  supported: boolean;
  ready: boolean;
  activeEngine: string;
  defaultEngine: string;
  googleInstalled: boolean;
  engines: { name: string; label: string }[];
  languages: Record<SpeechLanguage, LanguageStatus>;
  voices: VoiceInfo[];
  scrollServiceEnabled: boolean;
}

/** Result of a single voice preview. */
export type PreviewOutcome =
  | 'ok'
  | 'stopped'
  | 'busy'
  | 'voice_missing'
  | 'not_installed'
  | 'speech_failed'
  | 'not_ready'
  | 'unsupported';

/** Whether the saved voice can still be used on this device. */
export type SavedVoiceStatus = 'default' | 'available' | 'unavailable';

export type SpeechOutcome =
  | 'ok'
  | 'voice_missing'
  | 'speech_failed'
  | 'not_ready'
  | 'unsupported';

export interface OverlayStatus {
  /** False on platforms without the native module (iOS, tests). */
  supported: boolean;
  /** "Display over other apps" is granted. */
  overlayPermission: boolean;
  /** The floating button and capture session are live. */
  serviceRunning: boolean;
}

export type EnableOutcome =
  | 'started'
  | 'cancelled'
  | 'overlay_permission'
  | 'unsupported'
  | 'error';

/** Why the floating button is not running, when the user should be told. */
export type OverlayNotice =
  | 'overlay_permission'
  | 'cancelled'
  | 'revoked'
  | 'error'
  | null;
