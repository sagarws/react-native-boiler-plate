import { Platform, type TextStyle } from 'react-native';
import type { Typography } from '@/theme';

/**
 * Monospace text for headers, payloads and cURL. Kept here rather than in the
 * theme on purpose: theme text roles all follow the Modern/Classic preset,
 * while code must stay monospace in both, so it takes the caption's size and
 * swaps only the family (the system monospace face; nothing is bundled).
 */
export function codeText(typography: Typography): TextStyle {
  return {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  };
}
