import { DeviceEventEmitter } from 'react-native';
import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';
import { parseOcrResultJson, parseOcrResultList } from '../utils/parseResult';
import type {
  CaptureSettings,
  EnableOutcome,
  OcrResult,
  OverlayStatus,
} from '../capture.types';

const EVENT_RESULT = 'ScreenOcrResult';
const EVENT_STATUS = 'ScreenOcrStatus';

const UNSUPPORTED: OverlayStatus = {
  supported: false,
  overlayPermission: false,
  serviceRunning: false,
};

/** Colours the native bubble and controller take from the active theme. */
export interface OverlayColors {
  background: string;
  icon: string;
  panel: string;
  panelText: string;
}

/** The JSON the native service reads (OcrConfig.fromJson in Kotlin). */
export function buildNativeConfig(
  settings: CaptureSettings,
  colors: OverlayColors,
) {
  const { speech, reading } = settings;
  return {
    ocrMode: settings.ocrMode,
    action: settings.action,
    autoCopy: settings.autoCopy,
    saveHistory: settings.saveHistory,
    bubbleSizeDp: settings.bubbleSizeDp,
    bubbleOpacity: settings.bubbleOpacity,
    bubbleColor: colors.background,
    bubbleIconColor: colors.icon,
    panelColor: colors.panel,
    panelTextColor: colors.panelText,
    speech: {
      language: speech.language,
      voiceName: speech.voiceName,
      rate: speech.rate,
      pitch: speech.pitch,
      switchByScript: speech.switchByScript,
      preferGoogle: speech.preferGoogle,
      copyBeforeSpeaking: speech.copyBeforeSpeaking,
      stopOnScreenOff: speech.stopOnLeave,
      resumeAfterInterruption: speech.resumeAfterInterruption,
    },
    reading,
    pagination: settings.pagination,
    translate: settings.translate,
    refine: settings.refine,
  };
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

/**
 * The only door to the native screen-OCR module. Every call degrades to a
 * safe no-op where the module is absent (iOS, Jest), so callers need no
 * platform checks. Never logs extracted text.
 */
export const screenOcrService = {
  isSupported(): boolean {
    return NativeScreenOcr != null;
  },

  async getStatus(): Promise<OverlayStatus> {
    if (!NativeScreenOcr) return UNSUPPORTED;
    try {
      const status = await NativeScreenOcr.getStatus();
      return { supported: true, ...status };
    } catch (error) {
      logger.error('screenOcr.getStatus failed', error);
      return {
        supported: true,
        overlayPermission: false,
        serviceRunning: false,
      };
    }
  },

  async enable(): Promise<EnableOutcome> {
    if (!NativeScreenOcr) return 'unsupported';
    try {
      return (await NativeScreenOcr.startOverlay()) ? 'started' : 'cancelled';
    } catch (error) {
      if (errorCode(error) === 'overlay_permission')
        return 'overlay_permission';
      logger.error('screenOcr.enable failed', error);
      return 'error';
    }
  },

  disable(): void {
    NativeScreenOcr?.stopOverlay();
  },

  openOverlaySettings(): void {
    NativeScreenOcr?.openOverlaySettings();
  },

  pushConfig(settings: CaptureSettings, colors: OverlayColors): void {
    NativeScreenOcr?.updateConfig(
      JSON.stringify(buildNativeConfig(settings, colors)),
    );
  },

  resetBubblePosition(): void {
    NativeScreenOcr?.resetBubblePosition();
  },

  /** Copies text to the system clipboard. Resolves false on failure. */
  async copy(text: string): Promise<boolean> {
    if (!NativeScreenOcr || text.length === 0) return false;
    try {
      return await NativeScreenOcr.copyToClipboard(text);
    } catch (error) {
      logger.error('screenOcr.copy failed', error);
      return false;
    }
  },

  async latest(): Promise<OcrResult | null> {
    if (!NativeScreenOcr) return null;
    try {
      return parseOcrResultJson(await NativeScreenOcr.getLatestResult());
    } catch (error) {
      logger.error('screenOcr.latest failed', error);
      return null;
    }
  },

  /** Takes the captures queued by the service since the last call. */
  async drainPending(): Promise<OcrResult[]> {
    if (!NativeScreenOcr) return [];
    try {
      return parseOcrResultList(await NativeScreenOcr.consumePendingResults());
    } catch (error) {
      logger.error('screenOcr.drainPending failed', error);
      return [];
    }
  },

  clearCapturedData(): void {
    NativeScreenOcr?.clearCapturedData();
  },

  onResult(listener: () => void): () => void {
    const subscription = DeviceEventEmitter.addListener(EVENT_RESULT, listener);
    return () => subscription.remove();
  },

  onStatus(listener: () => void): () => void {
    const subscription = DeviceEventEmitter.addListener(EVENT_STATUS, listener);
    return () => subscription.remove();
  },
};
