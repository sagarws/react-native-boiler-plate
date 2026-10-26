import type { TextStyle } from 'react-native';
import { fontSize } from './responsive';

/** ReadexPro, the type family the previous app shipped with. */
export const fontFamily = {
  bold: 'ReadexPro-Bold',
  semiBold: 'ReadexPro-SemiBold',
  medium: 'ReadexPro-Medium',
  regular: 'ReadexPro-Regular',
  light: 'ReadexPro-Light',
  extraLight: 'ReadexPro-ExtraLight',
} as const;

// Weight comes from the family, so these carry no `fontWeight`: setting one
// alongside a named family makes Android fall back to a synthesised face.
export const typography = {
  h1: { fontSize: fontSize(22), fontFamily: fontFamily.bold } satisfies TextStyle,
  h2: { fontSize: fontSize(18), fontFamily: fontFamily.medium } satisfies TextStyle,
  body: { fontSize: fontSize(14), fontFamily: fontFamily.regular } satisfies TextStyle,
  caption: { fontSize: fontSize(12), fontFamily: fontFamily.regular } satisfies TextStyle,
  button: { fontSize: fontSize(16), fontFamily: fontFamily.medium } satisfies TextStyle,
  label: { fontSize: fontSize(16), fontFamily: fontFamily.medium } satisfies TextStyle,
} as const;

export type TypographyKey = keyof typeof typography;
