import { createLocalId as createId } from '@/shared/utils';
import { storage, StorageKeys } from '@/store/mmkv';
import {
  MEASURE_MODES,
  UNITS,
  WATER_DURATIONS,
  WATER_MODES,
  type CodeKind,
  type Measurement,
  type MeasureMode,
  type ScannedDocument,
  type ScanRecord,
  type UtilityData,
  type UtilityPrefs,
} from '../types';

/**
 * Utility persistence (MMKV): only what's useful later — scan history,
 * saved measurements, scanned documents' page lists, and preferences. No
 * live sensor data or camera frames are kept. Bad records are dropped on load.
 */

export const MAX_SCANS = 200;
export const MAX_MEASUREMENTS = 200;
const MAX_VALUE = 4000;

const KEYS = {
  scans: StorageKeys.UtilityScans,
  measurements: StorageKeys.UtilityMeasurements,
  documents: StorageKeys.UtilityDocuments,
  prefs: StorageKeys.UtilityPrefs,
} as const;

type R = Record<string, unknown>;
const str = (v: unknown, max = 200) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const iso = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))
    ? v
    : new Date(0).toISOString();
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;
const KINDS: readonly CodeKind[] = [
  'url',
  'phone',
  'email',
  'sms',
  'wifi',
  'geo',
  'product',
  'text',
];

function cleanScan(r: R): ScanRecord | null {
  if (typeof r.id !== 'string' || !str(r.value, MAX_VALUE)) return null;
  return {
    id: r.id,
    value: str(r.value, MAX_VALUE),
    format: str(r.format, 30) || 'UNKNOWN',
    kind: oneOf(r.kind, KINDS, 'text'),
    at: iso(r.at),
  };
}

function cleanMeasurement(r: R): Measurement | null {
  const meters =
    typeof r.meters === 'number' && Number.isFinite(r.meters) ? r.meters : NaN;
  if (typeof r.id !== 'string' || !(meters > 0)) return null;
  return {
    id: r.id,
    mode: oneOf(r.mode, MEASURE_MODES, 'length'),
    meters,
    source: str(r.source, 20),
    label: str(r.label, 80),
    at: iso(r.at),
  };
}

function cleanDocument(r: R): ScannedDocument | null {
  if (typeof r.id !== 'string' || !Array.isArray(r.pages)) return null;
  const pages = r.pages.filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return {
    id: r.id,
    name: str(r.name, 80) || 'Scan',
    pages,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

const DEFAULT_PREFS: UtilityPrefs = {
  unit: 'cm',
  waterMode: 'low',
  waterSeconds: 30,
  waterVibrate: false,
};

function cleanPrefs(v: unknown): UtilityPrefs {
  if (!v || typeof v !== 'object') return DEFAULT_PREFS;
  const r = v as R;
  return {
    unit: oneOf(r.unit, UNITS, DEFAULT_PREFS.unit),
    waterMode: oneOf(r.waterMode, WATER_MODES, DEFAULT_PREFS.waterMode),
    waterSeconds: (WATER_DURATIONS as readonly number[]).includes(
      r.waterSeconds as number,
    )
      ? (r.waterSeconds as number)
      : DEFAULT_PREFS.waterSeconds,
    waterVibrate: r.waterVibrate === true,
  };
}

function readList<T>(key: string, clean: (r: R) => T | null): T[] {
  try {
    const parsed: unknown = JSON.parse(storage.getString(key) ?? '[]');
    return Array.isArray(parsed)
      ? parsed
          .map(x => (x && typeof x === 'object' ? clean(x as R) : null))
          .filter((x): x is T => x !== null)
      : [];
  } catch {
    return [];
  }
}

function load(): UtilityData {
  let prefs: unknown = null;
  try {
    prefs = JSON.parse(storage.getString(KEYS.prefs) ?? 'null');
  } catch {
    prefs = null;
  }
  return {
    version: 0,
    scans: readList(KEYS.scans, cleanScan),
    measurements: readList(KEYS.measurements, cleanMeasurement),
    documents: readList(KEYS.documents, cleanDocument),
    prefs: cleanPrefs(prefs),
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: UtilityData | null = null;

function read(): UtilityData {
  if (!cache) cache = load();
  return cache;
}

function commit(
  next: Omit<UtilityData, 'version'>,
  changed: (keyof typeof KEYS)[],
) {
  cache = { ...next, version: read().version + 1 };
  for (const c of changed) storage.set(KEYS[c], JSON.stringify(cache[c]));
  listeners.forEach(l => l());
}

const now = () => new Date().toISOString();

export const utilityStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Newest first; the oldest drop off past MAX_SCANS. */
  addScan(input: Pick<ScanRecord, 'value' | 'format' | 'kind'>): ScanRecord {
    const d = read();
    const scan: ScanRecord = {
      id: createId(),
      value: input.value.slice(0, MAX_VALUE),
      format: input.format,
      kind: input.kind,
      at: now(),
    };
    commit({ ...d, scans: [scan, ...d.scans].slice(0, MAX_SCANS) }, ['scans']);
    return scan;
  },

  deleteScan(id: string) {
    const d = read();
    commit({ ...d, scans: d.scans.filter(s => s.id !== id) }, ['scans']);
  },

  clearScans() {
    commit({ ...read(), scans: [] }, ['scans']);
  },

  saveMeasurement(input: {
    mode: MeasureMode;
    meters: number;
    source: string;
    label?: string;
  }): Measurement | null {
    if (!(input.meters > 0) || !Number.isFinite(input.meters)) return null;
    const d = read();
    const m: Measurement = {
      id: createId(),
      mode: input.mode,
      meters: input.meters,
      source: input.source,
      label: (input.label ?? '').trim().slice(0, 80),
      at: now(),
    };
    commit(
      { ...d, measurements: [m, ...d.measurements].slice(0, MAX_MEASUREMENTS) },
      ['measurements'],
    );
    return m;
  },

  deleteMeasurement(id: string) {
    const d = read();
    commit({ ...d, measurements: d.measurements.filter(m => m.id !== id) }, [
      'measurements',
    ]);
  },

  createDocument(name: string, pages: string[]): ScannedDocument {
    const d = read();
    const t = now();
    const doc: ScannedDocument = {
      id: createId(),
      name: name.trim().slice(0, 80) || 'Scan',
      pages,
      createdAt: t,
      updatedAt: t,
    };
    commit({ ...d, documents: [doc, ...d.documents] }, ['documents']);
    return doc;
  },

  updateDocument(
    id: string,
    patch: Partial<Pick<ScannedDocument, 'name' | 'pages'>>,
  ): ScannedDocument | null {
    const d = read();
    const existing = d.documents.find(x => x.id === id);
    if (!existing) return null;
    const doc: ScannedDocument = {
      ...existing,
      ...patch,
      name: (patch.name ?? existing.name).trim().slice(0, 80) || existing.name,
      updatedAt: now(),
    };
    commit({ ...d, documents: d.documents.map(x => (x.id === id ? doc : x)) }, [
      'documents',
    ]);
    return doc;
  },

  /** Removes the record; returns its page paths so the caller deletes the files. */
  deleteDocument(id: string): string[] {
    const d = read();
    const doc = d.documents.find(x => x.id === id);
    commit({ ...d, documents: d.documents.filter(x => x.id !== id) }, [
      'documents',
    ]);
    return doc?.pages ?? [];
  },

  updatePrefs(patch: Partial<UtilityPrefs>): UtilityPrefs {
    const d = read();
    const prefs = cleanPrefs({ ...d.prefs, ...patch });
    commit({ ...d, prefs }, ['prefs']);
    return prefs;
  },

  /** Tests only. */
  resetCacheForTest() {
    cache = null;
  },
};
