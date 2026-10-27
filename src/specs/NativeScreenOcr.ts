import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Android screen-OCR module
 * (android/app/src/main/java/com/rnboilerplate/screenocr/ScreenOcrModule.kt).
 *
 * Only the capture feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 */
export interface Spec extends TurboModule {
  getStatus(): Promise<{ overlayPermission: boolean; serviceRunning: boolean }>;
  openOverlaySettings(): void;
  /**
   * Shows the system capture-consent dialog and starts the floating button.
   * Resolves false when the user declines; rejects with code
   * `overlay_permission` when "Display over other apps" is not granted.
   */
  startOverlay(): Promise<boolean>;
  stopOverlay(): void;
  /** Full settings + theme colours as JSON (see captureSync / pushConfig). */
  updateConfig(configJson: string): void;
  resetBubblePosition(): void;
  copyToClipboard(text: string): Promise<boolean>;
  /** JSON of the latest capture this process made, or '' if none. */
  getLatestResult(): Promise<string>;
  /** JSON array of captures queued while history is on; empties the queue. */
  consumePendingResults(): Promise<string>;
  /** Forgets the latest capture and any queued ones. */
  clearCapturedData(): void;

  /** JSON: TTS engines, active engine, per-language status, voices. */
  getSpeechInfo(): Promise<string>;
  openTtsSettings(): void;
  /** Opens the active engine's voice-data installer. */
  installVoiceData(): void;
  /**
   * Speaks [text] once with the given voice settings. Resolves 'ok',
   * 'voice_missing', 'speech_failed' or 'not_ready'.
   */
  testVoice(
    text: string,
    language: string,
    voiceName: string,
    rate: number,
    pitch: number,
  ): Promise<string>;
  /** Reads text aloud with the saved speech settings; resolves when finished. */
  speakText(text: string): Promise<string>;
  stopSpeech(): void;
  /** The auto-scroll accessibility service is enabled in system settings. */
  isScrollServiceEnabled(): Promise<boolean>;
  openAccessibilitySettings(): void;

  /**
   * JSON of the pinned pagination target plus `problem` (none / rotated /
   * resized / density_changed / out_of_bounds / not_identifiable) checked
   * against the current screen; '' when none is saved.
   */
  getPaginationTarget(): Promise<string>;
  clearPaginationTarget(): void;
  /**
   * Shows the Next-button picker over other apps. Resolves 'started', or
   * 'not_running' when the floating button is off.
   */
  startTargetCalibration(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('ScreenOcr');
