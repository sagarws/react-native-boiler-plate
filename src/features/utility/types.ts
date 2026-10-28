export const MEASURE_MODES = ['length', 'height', 'distance'] as const;
export type MeasureMode = (typeof MEASURE_MODES)[number];

export const UNITS = ['cm', 'm', 'in', 'ft'] as const;
export type LengthUnit = (typeof UNITS)[number];

export const WATER_MODES = ['low', 'sweep', 'pulse'] as const;
export type WaterMode = (typeof WATER_MODES)[number];

export const WATER_DURATIONS = [15, 30, 60, 90] as const;

/** What a scanned code holds, decided from its text (see services/qr.ts). */
export type CodeKind =
  | 'url'
  | 'phone'
  | 'email'
  | 'sms'
  | 'wifi'
  | 'geo'
  | 'product'
  | 'text';

export interface ScanRecord {
  id: string;
  value: string;
  /** ML Kit format, e.g. QR_CODE, EAN_13. */
  format: string;
  kind: CodeKind;
  at: string;
}

export interface Measurement {
  id: string;
  mode: MeasureMode;
  meters: number;
  /** Which ARCore surface the points were on: plane | depth | point. */
  source: string;
  label: string;
  at: string;
}

export interface ScannedDocument {
  id: string;
  name: string;
  /** Private page image paths, in order. */
  pages: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UtilityPrefs {
  unit: LengthUnit;
  waterMode: WaterMode;
  waterSeconds: number;
  waterVibrate: boolean;
}

export interface UtilityData {
  version: number;
  scans: ScanRecord[];
  measurements: Measurement[];
  documents: ScannedDocument[];
  prefs: UtilityPrefs;
}
