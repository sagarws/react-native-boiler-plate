import { DeviceEventEmitter } from 'react-native';
import NativeUtility from '@/specs/NativeUtility';
import { logger } from '@/shared/utils';
import type { LengthUnit, MeasureMode, WaterMode } from '../types';

export type CompassSupport = 'rotation_vector' | 'accel_mag' | 'none';
export type ArSupport =
  | 'supported'
  | 'install_required'
  | 'unsupported'
  | 'unknown';

export interface CompassReading {
  /** 0–359.9, magnetic north. */
  heading: number;
  /** Android sensor accuracy: 0 unreliable … 3 high. */
  accuracy: number;
}

export interface BarcodeResult {
  value: string;
  format: string;
  wifi?: { ssid: string; password: string; type: number };
}

export interface MeasureResult {
  mode: MeasureMode;
  meters: number;
  source: string;
}

/** A failed native call: a known code (e.g. camera_permission) or 'unavailable'. */
export class UtilityError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || (error as Error)?.message || 'failed';

function need() {
  if (!NativeUtility) throw new UtilityError('unavailable');
  return NativeUtility;
}

function parse<T>(json: string): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Utility's bridge to Android. Each call fails on its own with a
 * UtilityError the calling screen turns into a message. Scanned content and
 * documents stay on the device and are never logged.
 */
export const utilityNative = {
  available: (): boolean => NativeUtility != null,

  // ── Compass ──
  async compassSupport(): Promise<CompassSupport> {
    if (!NativeUtility) return 'none';
    return (await NativeUtility.getCompassSupport()) as CompassSupport;
  },
  /** Starts the sensors and returns an unsubscribe that also stops them. */
  watchCompass(onReading: (r: CompassReading) => void): () => void {
    if (!NativeUtility) return () => {};
    const sub = DeviceEventEmitter.addListener('UtilityCompass', onReading);
    NativeUtility.startCompass();
    return () => {
      sub.remove();
      NativeUtility?.stopCompass();
    };
  },

  // ── Water eject ──
  async hasVibrator(): Promise<boolean> {
    return NativeUtility ? NativeUtility.hasVibrator() : false;
  },
  async startTone(
    mode: WaterMode,
    seconds: number,
    vibrate: boolean,
  ): Promise<'playing' | 'focus_denied'> {
    return (await need().startTone(mode, seconds * 1000, vibrate)) as
      | 'playing'
      | 'focus_denied';
  },
  stopTone() {
    NativeUtility?.stopTone();
  },
  onToneEnded(listener: (reason: string) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'UtilityToneEnded',
      (e: { reason: string }) => listener(e?.reason ?? 'finished'),
    );
    return () => sub.remove();
  },

  // ── Barcode ──
  /** null = the user closed the scanner. */
  async scanBarcode(
    labels: Record<string, string>,
  ): Promise<BarcodeResult | null> {
    try {
      return parse<BarcodeResult>(
        await need().scanBarcode(JSON.stringify(labels)),
      );
    } catch (error) {
      throw new UtilityError(errorCode(error));
    }
  },

  // ── Documents ──
  async documentScannerAvailable(): Promise<boolean> {
    if (!NativeUtility) return false;
    return (await NativeUtility.getDocumentScannerSupport()) === 'available';
  },
  /** Page paths, or null when cancelled. */
  async scanDocument(pageLimit: number): Promise<string[] | null> {
    try {
      return parse<string[]>(await need().scanDocument(pageLimit));
    } catch (error) {
      logger.warn('document scan failed', errorCode(error));
      throw new UtilityError(errorCode(error));
    }
  },
  async rotate(path: string, degrees: number): Promise<string> {
    try {
      return await need().rotateImage(path, degrees);
    } catch (error) {
      throw new UtilityError(errorCode(error));
    }
  },
  async exportPdf(pages: string[], fileName: string): Promise<boolean> {
    try {
      return await need().exportPdf(JSON.stringify(pages), fileName);
    } catch (error) {
      logger.warn('pdf export failed', errorCode(error));
      throw new UtilityError(errorCode(error));
    }
  },
  async exportImages(
    pages: string[],
    format: 'jpeg' | 'png',
    baseName: string,
  ): Promise<number> {
    try {
      return await need().exportImages(JSON.stringify(pages), format, baseName);
    } catch (error) {
      logger.warn('image export failed', errorCode(error));
      throw new UtilityError(errorCode(error));
    }
  },
  async sharePdf(pages: string[], fileName: string): Promise<boolean> {
    try {
      return await need().sharePdf(JSON.stringify(pages), fileName);
    } catch (error) {
      throw new UtilityError(errorCode(error));
    }
  },
  deleteFiles(paths: string[]) {
    if (paths.length) NativeUtility?.deleteFiles(JSON.stringify(paths));
  },

  // ── AR Measure ──
  async arSupport(): Promise<ArSupport> {
    if (!NativeUtility) return 'unsupported';
    return (await NativeUtility.getArSupport()) as ArSupport;
  },
  /** null = closed without a result. */
  async measure(
    mode: MeasureMode,
    unit: LengthUnit,
    labels: Record<string, string>,
  ): Promise<MeasureResult | null> {
    try {
      return parse<MeasureResult>(
        await need().measure(mode, unit, JSON.stringify(labels)),
      );
    } catch (error) {
      throw new UtilityError(errorCode(error));
    }
  },
};
