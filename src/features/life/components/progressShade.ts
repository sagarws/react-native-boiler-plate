import type { ColorPalette } from '@/theme';
import type { ProgressLevel } from '../services/progress';

/** Fill strength per level: light → strongest. */
const ALPHA: Record<Exclude<ProgressLevel, 'none' | 'noReport'>, number> = {
  low: 0.2,
  partial: 0.45,
  high: 0.75,
  full: 1,
};

/** "#RRGGBB" + alpha → "#RRGGBBAA" (other formats are returned unchanged). */
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export interface Shade {
  backgroundColor: string;
  /** Text drawn on the fill. */
  color: string;
  borderColor: string;
}

/**
 * Calendar cell colours for a level, on the task's / project's [base]
 * colour (a mid-tone palette colour that keeps white text readable at full
 * strength). Neutral levels use the surface; "scheduled, nothing reported"
 * gets a border so it reads differently from "no target".
 */
export function shadeFor(
  level: ProgressLevel,
  base: string,
  colors: ColorPalette,
): Shade {
  if (level === 'none')
    return {
      backgroundColor: 'transparent',
      color: colors.textSecondary,
      borderColor: 'transparent',
    };
  if (level === 'noReport')
    return {
      backgroundColor: colors.surfaceMuted,
      color: colors.textSecondary,
      borderColor: colors.border,
    };
  const strong = level === 'high' || level === 'full';
  return {
    backgroundColor: withAlpha(base, ALPHA[level]),
    color: strong ? colors.primaryForeground : colors.textPrimary,
    borderColor: 'transparent',
  };
}
