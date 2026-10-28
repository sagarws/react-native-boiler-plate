import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Utility tools module
 * (android/app/src/main/java/com/rnboilerplate/utility/UtilityModule.kt).
 *
 * Only the utility feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 *
 * Events (DeviceEventEmitter): `UtilityCompass` {heading, accuracy},
 * `UtilityToneEnded` {reason}.
 */
export interface Spec extends TurboModule {
  // ── Compass ──
  /** 'rotation_vector' | 'accel_mag' | 'none'. */
  getCompassSupport(): Promise<string>;
  startCompass(): void;
  stopCompass(): void;

  // ── Speaker water eject ──
  hasVibrator(): Promise<boolean>;
  /**
   * Plays the tone for [durationMs] ('low' | 'sweep' | 'pulse'), optionally
   * with a gentle vibration pattern. Resolves 'playing' or 'focus_denied'
   * (another app holds audio, e.g. a call).
   */
  startTone(
    mode: string,
    durationMs: number,
    vibrate: boolean,
  ): Promise<string>;
  stopTone(): void;

  // ── QR & barcode ──
  /**
   * Opens the camera scanner. Resolves the result as JSON, or '' when the
   * user closed it. Rejects `camera_permission` / `camera_failed`.
   */
  scanBarcode(labelsJson: string): Promise<string>;

  // ── Document scanner ──
  /** 'available' | 'unavailable' (no Google Play services). */
  getDocumentScannerSupport(): Promise<string>;
  /**
   * Opens Google's document scanner (edge detection, corner adjustment,
   * perspective correction, filters). Resolves a JSON array of page image
   * paths copied into private storage, or '' when cancelled.
   */
  scanDocument(pageLimit: number): Promise<string>;
  /** Rotates a page image; resolves the new file path. */
  rotateImage(path: string, degrees: number): Promise<string>;
  /** Multi-page PDF of [pagesJson] (paths, in order) via "Save to…". */
  exportPdf(pagesJson: string, fileName: string): Promise<boolean>;
  /**
   * Each page as a JPEG or PNG into a folder the user picks. Resolves the
   * number of files written (0 = cancelled).
   */
  exportImages(
    pagesJson: string,
    format: string,
    baseName: string,
  ): Promise<number>;
  /** Builds the PDF in the cache and opens the share sheet. */
  sharePdf(pagesJson: string, fileName: string): Promise<boolean>;
  /** Deletes private page files (only inside app storage). */
  deleteFiles(pathsJson: string): void;

  // ── AR Measure ──
  /** 'supported' | 'install_required' | 'unsupported' | 'unknown'. */
  getArSupport(): Promise<string>;
  /**
   * Opens the AR measuring camera in [mode] ('length' | 'height' |
   * 'distance'). Resolves JSON {mode, meters, source} or '' when closed
   * without a result. Rejects `ar_unsupported` / `ar_install_declined` /
   * `camera_permission` / `ar_failed`.
   */
  measure(mode: string, unit: string, labelsJson: string): Promise<string>;
}

export default TurboModuleRegistry.get<Spec>('Utility');
