/** Which recogniser(s) the floating button runs. */
export type OcrMode = 'english' | 'hindi' | 'mixed';

export const OCR_MODES: readonly OcrMode[] = ['english', 'hindi', 'mixed'];

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
}

/** User settings for capture; persisted in MMKV and mirrored to native. */
export interface CaptureSettings {
  ocrMode: OcrMode;
  autoCopy: boolean;
  saveHistory: boolean;
  bubbleSizeDp: number;
  bubbleOpacity: number;
}

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
