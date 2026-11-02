import type { ColorPalette } from '@/theme';
import type { ProgressLevel } from '../services/progress';

/** Opacity of the base colour per level; neutral uses the muted surface. */
const ALPHA: Record<Exclude<ProgressLevel, 'none'>, number> = {
  low: 0.2,
  partial: 0.45,
  high: 0.72,
  full: 1,
};

/** "#7C3AED" + 0.45 → "rgba(124,58,237,0.45)"; other formats pass through. */
export function tint(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

export interface LevelStyle {
  background: string;
  foreground: string;
}

/**
 * Calendar cell colours for a completion level, as a single-hue scale of
 * [base] (the task's or project's colour). Each cell also shows its percent,
 * so the scale never relies on colour alone.
 */
export function levelStyle(
  base: string,
  level: ProgressLevel,
  colors: ColorPalette,
): LevelStyle {
  if (level === 'none') {
    return { background: colors.surfaceMuted, foreground: colors.textPrimary };
  }
  return {
    background: tint(base, ALPHA[level]),
    foreground:
      level === 'full' || level === 'high'
        ? colors.primaryForeground
        : colors.textPrimary,
  };
}
