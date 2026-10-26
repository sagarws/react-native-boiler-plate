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
  updateConfig(config: {
    ocrMode: string;
    autoCopy: boolean;
    saveHistory: boolean;
    bubbleSizeDp: number;
    bubbleOpacity: number;
    bubbleColor: string;
    bubbleIconColor: string;
  }): void;
  resetBubblePosition(): void;
  copyToClipboard(text: string): Promise<boolean>;
  /** JSON of the latest capture this process made, or '' if none. */
  getLatestResult(): Promise<string>;
  /** JSON array of captures queued while history is on; empties the queue. */
  consumePendingResults(): Promise<string>;
  /** Forgets the latest capture and any queued ones. */
  clearCapturedData(): void;
}

export default TurboModuleRegistry.get<Spec>('ScreenOcr');
