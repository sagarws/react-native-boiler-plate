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
  /**
   * Plays a sample with exactly this installed voice (no substitute).
   * Resolves 'ok', 'stopped' (Stop pressed or replaced by another preview),
   * 'busy' (a reading session is speaking), 'voice_missing', 'not_installed',
   * 'speech_failed' or 'not_ready'.
   */
  previewVoice(
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

  /**
   * Saves the user's Gemini API key encrypted with an Android Keystore key.
   * Resolves false if encryption failed. The key can never be read back from
   * JS — only `getGeminiKeyStatus`.
   */
  setGeminiKey(apiKey: string): Promise<boolean>;
  clearGeminiKey(): void;
  /** JSON {"hasKey": boolean, "hint": "last 4 chars"}. */
  getGeminiKeyStatus(): Promise<string>;
  /**
   * Sends a tiny translation request with the saved key and current
   * settings. Resolves JSON {"outcome": "ok" | error code, "status": HTTP
   * status, "detail": Google's error message (redacted), "sample"}.
   */
  testGeminiKey(): Promise<string>;
  /** JSON {"outcome", "models": [{"id", "displayName"}]} — the models this key can call. */
  listGeminiModels(): Promise<string>;
  /**
   * Audio sharing with the Chrome extension (started/stopped by
   * config.audioShare.enabled). JSON {state: off|waiting|pending|connected|
   * streaming, address, port, receiverName, fingerprint, transmitting,
   * error}. Pairing is by address + the user's Allow (no code).
   */
  getAudioShareStatus(): Promise<string>;
  /** Allow or deny the pending connection request. */
  respondAudioShare(approve: boolean): void;
  /** Ends the receiver's session (it must pair again). */
  disconnectAudioShare(): void;
  /**
   * File Management's shared Google Drive (Settings → File Management),
   * stored encrypted. JSON {clientId, clientSecret, refreshToken, folderId};
   * a blank secret field keeps the stored value. Resolves whether it saved.
   */
  setDriveCredentials(json: string): Promise<boolean>;
  /**
   * JSON {configured, source: saved|default|none, hasDefaults, clientId,
   * folderId, secretHint, tokenHint} — never the secrets. "default" means the
   * build's .env values (GOOGLE_DRIVE_*) are in use.
   */
  getDriveCredentialStatus(): Promise<string>;
  /** Forgets saved values and stops using the build defaults. */
  clearDriveCredentials(): void;
  /** Forgets saved values and goes back to the build defaults. */
  restoreDriveDefaults(): void;
  /**
   * A short-lived Drive access token from the stored refresh token. Rejects
   * with code not_configured | invalid_token | invalid_client | no_internet |
   * timeout | server.
   */
  getDriveAccessToken(forceRefresh: boolean): Promise<string>;
  clearPaginationTarget(): void;
  /**
   * Shows the Next-button picker over other apps. Resolves 'started', or
   * 'not_running' when the floating button is off.
   */
  startTargetCalibration(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('ScreenOcr');
