import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Screen Recorder module
 * (android/app/src/main/java/com/rnboilerplate/recorder/RecorderModule.kt).
 *
 * Only the utility feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 * Independent of NativeScreenOcr — its own button, consent and settings.
 *
 * Event (DeviceEventEmitter): `RecorderEvent` {type, …} — state changes and
 * progress only (see RecorderEvents.kt), never frames or audio.
 * JSON shapes are parsed and validated in services/recorder.service.ts.
 */
export interface Spec extends TurboModule {
  /** JSON: permissions, API level, bubble/session state. */
  getStatus(): Promise<string>;
  /** JSON of the persisted recorder settings. */
  getConfig(): Promise<string>;
  /** Merges [patchJson] into the settings; resolves the full settings JSON. */
  updateConfig(patchJson: string): Promise<string>;
  /** 'shown' | 'hidden' | 'overlay_permission'. */
  setBubbleEnabled(enabled: boolean): Promise<string>;
  openOverlaySettings(): void;
  resetBubblePosition(): void;
  /** Runs a mode from the app ('screenshot' | 'screen' | 'voice' | 'screen_voice'). */
  runAction(mode: string): void;
  stopRecording(): void;
  pauseResume(): void;
  /** Releases the held screen-capture session. */
  endCapture(): void;

  // ── Library ──
  /** JSON array of recordings, newest first. */
  listRecordings(): Promise<string>;
  /** Resolves the updated entry JSON. Rejects `invalid_name` / `rename_failed`. */
  renameRecording(id: string, name: string): Promise<string>;
  deleteRecording(id: string): Promise<boolean>;
  /** Merges (or re-merges) a session's kept segments in the background. */
  remerge(id: string): void;
  /** Opens the file in a viewer/player app. */
  openRecording(id: string): Promise<boolean>;
  /** Opens one kept segment (0-based index) in a player app. */
  openSegment(id: string, index: number): Promise<boolean>;
  shareRecording(id: string): Promise<boolean>;
  /** Opens a saved screenshot in the annotation editor (saves a copy). */
  editScreenshot(id: string): Promise<boolean>;

  // ── Storage & quality ──
  /** Folder picker for [kind]; resolves the folder's status JSON, or '' when cancelled. */
  pickDirectory(kind: string): Promise<string>;
  /** Back to the default location for [kind]. */
  clearDirectory(kind: string): Promise<boolean>;
  /** JSON {kind: {label, custom, accessible, freeBytes}}. */
  getDirectories(): Promise<string>;
  testDirectory(kind: string): Promise<boolean>;
  /** JSON {screenWidth, screenHeight, encoder, presets: {low|medium|high|custom: {width, height, fps, bitrate}}}. */
  getVideoCapabilities(): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('Recorder');
