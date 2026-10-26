import type { TextStyle } from 'react-native';
import { fontSize } from './responsive';

export const TYPOGRAPHY_PRESET_IDS = ['modern', 'classic'] as const;
export type TypographyPresetId = (typeof TYPOGRAPHY_PRESET_IDS)[number];
export const DEFAULT_TYPOGRAPHY_PRESET: TypographyPresetId = 'modern';

export function isTypographyPresetId(
  value: unknown,
): value is TypographyPresetId {
  return (
    typeof value === 'string' &&
    (TYPOGRAPHY_PRESET_IDS as readonly string[]).includes(value)
  );
}

/** ReadexPro, bundled under android/app/src/main/assets/fonts (SIL OFL). */
export const fontFamily = {
  bold: 'ReadexPro-Bold',
  semiBold: 'ReadexPro-SemiBold',
  medium: 'ReadexPro-Medium',
  regular: 'ReadexPro-Regular',
  light: 'ReadexPro-Light',
  extraLight: 'ReadexPro-ExtraLight',
} as const;

type Weight = 'regular' | 'medium' | 'bold';

/**
 * Resolves one weight to a concrete face.
 *
 * Modern uses the bundled ReadexPro faces, where weight comes from the family
 * name — setting `fontWeight` alongside a named family makes Android
 * synthesise a face. Classic uses the system serif (Noto Serif on Android),
 * which ships real weights, so it takes `fontWeight` instead.
 *
 * Neither face carries Devanagari; Android falls back to the system Noto
 * Devanagari face glyph by glyph, so Hindi renders in both presets.
 */
function face(preset: TypographyPresetId, weight: Weight): TextStyle {
  if (preset === 'classic') {
    return {
      fontFamily: 'serif',
      fontWeight:
        weight === 'bold' ? '700' : weight === 'medium' ? '600' : '400',
    };
  }
  const family =
    weight === 'bold'
      ? fontFamily.semiBold
      : weight === 'medium'
      ? fontFamily.medium
      : fontFamily.regular;
  return { fontFamily: family };
}

/**
 * Type scale for a preset. Line heights are generous (≈1.4–1.6×) because
 * Devanagari's matras sit above and below the Latin x-height and clip at
 * tight leading.
 */
export function buildTypography(preset: TypographyPresetId) {
  const classic = preset === 'classic';
  const size = (value: number) => fontSize(value);
  const line = (value: number, ratio: number) =>
    Math.round(fontSize(value) * ratio);

  return {
    display: {
      ...face(preset, 'bold'),
      fontSize: size(26),
      lineHeight: line(26, 1.3),
      letterSpacing: classic ? 0 : -0.3,
    } satisfies TextStyle,
    h1: {
      ...face(preset, 'bold'),
      fontSize: size(22),
      lineHeight: line(22, 1.35),
    } satisfies TextStyle,
    h2: {
      ...face(preset, 'medium'),
      fontSize: size(18),
      lineHeight: line(18, 1.4),
    } satisfies TextStyle,
    title: {
      ...face(preset, 'medium'),
      fontSize: size(16),
      lineHeight: line(16, 1.45),
    } satisfies TextStyle,
    body: {
      ...face(preset, 'regular'),
      fontSize: size(14),
      lineHeight: line(14, classic ? 1.6 : 1.5),
    } satisfies TextStyle,
    caption: {
      ...face(preset, 'regular'),
      fontSize: size(12),
      lineHeight: line(12, 1.5),
    } satisfies TextStyle,
    overline: {
      ...face(preset, 'medium'),
      fontSize: size(11),
      lineHeight: line(11, 1.5),
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    } satisfies TextStyle,
    button: {
      ...face(preset, 'medium'),
      fontSize: size(15),
      lineHeight: line(15, 1.4),
    } satisfies TextStyle,
    label: {
      ...face(preset, 'medium'),
      fontSize: size(15),
      lineHeight: line(15, 1.45),
    } satisfies TextStyle,
    /** Extracted text: larger, airier, so mixed Hindi/English reads easily. */
    reading: {
      ...face(preset, 'regular'),
      fontSize: size(16),
      lineHeight: line(16, 1.65),
    } satisfies TextStyle,
  };
}

export type Typography = ReturnType<typeof buildTypography>;
export type TypographyKey = keyof Typography;

/** The Modern scale, for module-scope styles that cannot read the theme. */
export const typography: Typography = buildTypography(
  DEFAULT_TYPOGRAPHY_PRESET,
);
