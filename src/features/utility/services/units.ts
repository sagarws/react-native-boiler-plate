import type { LengthUnit } from '../types';

const PER_METER: Record<LengthUnit, number> = {
  cm: 100,
  m: 1,
  in: 1 / 0.0254,
  ft: 1 / 0.3048,
};
const DECIMALS: Record<LengthUnit, number> = { cm: 1, m: 2, in: 1, ft: 2 };

/** "123.4 cm", "1.23 m", "48.6 in", "4.05 ft" (number in the device locale). */
export function formatLength(meters: number, unit: LengthUnit): string {
  const value = meters * PER_METER[unit];
  return `${value.toLocaleString(undefined, {
    minimumFractionDigits: DECIMALS[unit],
    maximumFractionDigits: DECIMALS[unit],
  })} ${unit}`;
}

/** 0–359 → N, NE, E … (eight points). */
export function cardinal(
  heading: number,
): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
  return points[Math.round((((heading % 360) + 360) % 360) / 45) % 8];
}
