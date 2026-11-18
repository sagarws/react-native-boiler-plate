/**
 * Unit converter. Each unit is defined by how many base units it is
 * (linear) — except temperature, which has offsets. Pure; offline.
 * Unit display names are i18n keys `utility.unitName_<id>`.
 */

export const CONVERT_CATEGORIES = [
  'length',
  'area',
  'mass',
  'volume',
  'temperature',
  'speed',
  'data',
] as const;
export type ConvertCategory = (typeof CONVERT_CATEGORIES)[number];

interface LinearUnit {
  id: string;
  /** Base units per one of this unit. */
  factor: number;
}

/** Base units: metre, square metre, kilogram, litre, m/s, byte. */
const LINEAR: Record<Exclude<ConvertCategory, 'temperature'>, LinearUnit[]> = {
  length: [
    { id: 'mm', factor: 0.001 },
    { id: 'cm', factor: 0.01 },
    { id: 'm', factor: 1 },
    { id: 'km', factor: 1000 },
    { id: 'in', factor: 0.0254 },
    { id: 'ft', factor: 0.3048 },
    { id: 'yd', factor: 0.9144 },
    { id: 'mi', factor: 1609.344 },
  ],
  area: [
    { id: 'cm2', factor: 0.0001 },
    { id: 'm2', factor: 1 },
    { id: 'ft2', factor: 0.09290304 },
    { id: 'yd2', factor: 0.83612736 },
    { id: 'acre', factor: 4046.8564224 },
    { id: 'ha', factor: 10_000 },
    { id: 'km2', factor: 1_000_000 },
  ],
  mass: [
    { id: 'mg', factor: 0.000001 },
    { id: 'g', factor: 0.001 },
    { id: 'kg', factor: 1 },
    { id: 't', factor: 1000 },
    { id: 'oz', factor: 0.028349523125 },
    { id: 'lb', factor: 0.45359237 },
  ],
  volume: [
    { id: 'ml', factor: 0.001 },
    { id: 'l', factor: 1 },
    { id: 'm3', factor: 1000 },
    { id: 'tsp', factor: 0.00492892159375 },
    { id: 'tbsp', factor: 0.01478676478125 },
    { id: 'cup', factor: 0.2365882365 },
    { id: 'floz', factor: 0.0295735295625 },
    { id: 'gal', factor: 3.785411784 },
  ],
  speed: [
    { id: 'mps', factor: 1 },
    { id: 'kmh', factor: 1 / 3.6 },
    { id: 'mph', factor: 0.44704 },
    { id: 'kn', factor: 1852 / 3600 },
  ],
  data: [
    { id: 'B', factor: 1 },
    { id: 'KB', factor: 1024 },
    { id: 'MB', factor: 1024 ** 2 },
    { id: 'GB', factor: 1024 ** 3 },
    { id: 'TB', factor: 1024 ** 4 },
  ],
};

const TEMPERATURE = ['C', 'F', 'K'] as const;

export function unitsOf(category: ConvertCategory): string[] {
  return category === 'temperature'
    ? [...TEMPERATURE]
    : LINEAR[category].map(u => u.id);
}

/** Defaults shown when a category opens. */
export const DEFAULT_UNIT: Record<ConvertCategory, string> = {
  length: 'm',
  area: 'm2',
  mass: 'kg',
  volume: 'l',
  temperature: 'C',
  speed: 'kmh',
  data: 'MB',
};

function toKelvin(v: number, unit: string): number {
  if (unit === 'C') return v + 273.15;
  if (unit === 'F') return ((v - 32) * 5) / 9 + 273.15;
  return v;
}

function fromKelvin(k: number, unit: string): number {
  if (unit === 'C') return k - 273.15;
  if (unit === 'F') return ((k - 273.15) * 9) / 5 + 32;
  return k;
}

/** [value] in [from] → [to]; NaN for an unknown unit or invalid value. */
export function convert(
  category: ConvertCategory,
  value: number,
  from: string,
  to: string,
): number {
  if (!Number.isFinite(value)) return NaN;
  if (category === 'temperature') {
    const all: readonly string[] = TEMPERATURE;
    if (!all.includes(from) || !all.includes(to)) return NaN;
    const k = toKelvin(value, from);
    return k < 0 ? NaN : fromKelvin(k, to);
  }
  const units = LINEAR[category];
  const a = units.find(u => u.id === from);
  const b = units.find(u => u.id === to);
  if (!a || !b) return NaN;
  return (value * a.factor) / b.factor;
}

/** Parses "1,5", "1.5", "-3", "2e3"; NaN when not a number. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return NaN;
  return Number(t);
}

/** Up to 6 significant digits, no float noise ("0.000123", "1.23457e+9" → locale). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '–';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e12 || abs < 1e-6) return n.toExponential(4);
  const precise = Number(n.toPrecision(6));
  return precise.toLocaleString(undefined, { maximumFractionDigits: 10 });
}
