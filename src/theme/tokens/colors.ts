// App palette. Replace the hex values with your brand colours.
// Two full palettes — light and dark — with identical keys, so
// `useTheme().colors` always resolves every token.

const lightPalette = {
  background: '#F1F8F9',
  foreground: '#000000',
  surface: '#FFFFFF',
  surface2: '#EFF0F2',
  ink: '#000000',

  card: '#FFFFFF',
  cardForeground: '#000000',
  popover: '#FFFFFF',
  popoverForeground: '#000000',

  primary: '#4DA9B2',
  primaryForeground: '#FFFFFF',
  secondary: '#EFF0F2',
  secondaryForeground: '#000000',
  muted: '#EFF0F2',
  mutedForeground: '#777777',
  accent: '#4DA9B214',
  accentForeground: '#4DA9B2',

  destructive: '#FB403F',
  destructiveForeground: '#FFFFFF',

  border: '#C2C2C2',
  input: '#C2C2C2',
  ring: '#4DA9B2',

  amber: '#F5A623',
  amberForeground: '#000000',
  steel: '#777777',
  steelForeground: '#FFFFFF',
  signal: '#FB403F',
  signalForeground: '#FFFFFF',
  jobsite: '#4FBA6F',
  jobsiteForeground: '#FFFFFF',

  sidebar: '#4DA9B2',
  sidebarForeground: '#FFFFFF',
  sidebarPrimary: '#4DA9B2',
  sidebarPrimaryForeground: '#FFFFFF',
  sidebarAccent: '#FFFFFF',
  sidebarAccentForeground: '#000000',
  sidebarBorder: '#E0E0E0',
  sidebarRing: '#4DA9B2',

  // Legacy names carried over verbatim from the previous app so restored
  // screens read the same way they did there.
  good: '#4FBA6F',
  bad: '#FB403F',
  red: '#FF0000',
  grey: '#777777',
  lightGrey: '#D3D3D3',
  inputBorder: '#C2C2C2',
  scrim: 'rgba(0,0,0,0.5)',
  scrimLight: 'rgba(0,0,0,0.2)',
  // Always-light text for content drawn over a camera feed, which has no
  // theme of its own.
  overlayText: '#FFFFFF',
  overlayTextMuted: 'rgba(255,255,255,0.6)',

  // Aliases kept so existing consumers keep compiling.
  text: '#000000',
  textMuted: '#777777',
  onPrimary: '#FFFFFF',
  danger: '#FB403F',
};

const darkPalette: typeof lightPalette = {
  background: '#0E1719',
  foreground: '#F1F5F5',
  surface: '#152225',
  surface2: '#1C2C30',
  ink: '#000000',

  card: '#152225',
  cardForeground: '#F1F5F5',
  popover: '#152225',
  popoverForeground: '#F1F5F5',

  primary: '#4DA9B2',
  primaryForeground: '#04191C',
  secondary: '#1C2C30',
  secondaryForeground: '#F1F5F5',
  muted: '#1C2C30',
  mutedForeground: '#9AA8AB',
  accent: '#4DA9B233',
  accentForeground: '#7FC7CE',

  destructive: '#FB403F',
  destructiveForeground: '#FFFFFF',

  border: '#2A3B3F',
  input: '#2A3B3F',
  ring: '#4DA9B2',

  amber: '#F5A623',
  amberForeground: '#000000',
  steel: '#9AA8AB',
  steelForeground: '#04191C',
  signal: '#FB403F',
  signalForeground: '#FFFFFF',
  jobsite: '#4FBA6F',
  jobsiteForeground: '#04191C',

  sidebar: '#4DA9B2',
  sidebarForeground: '#FFFFFF',
  sidebarPrimary: '#4DA9B2',
  sidebarPrimaryForeground: '#FFFFFF',
  sidebarAccent: '#152225',
  sidebarAccentForeground: '#F1F5F5',
  sidebarBorder: '#2A3B3F',
  sidebarRing: '#4DA9B2',

  good: '#4FBA6F',
  bad: '#FB403F',
  red: '#FF6B6B',
  grey: '#9AA8AB',
  lightGrey: '#3A4A4E',
  inputBorder: '#2A3B3F',
  scrim: 'rgba(0,0,0,0.6)',
  scrimLight: 'rgba(0,0,0,0.35)',
  overlayText: '#FFFFFF',
  overlayTextMuted: 'rgba(255,255,255,0.6)',

  text: '#F1F5F5',
  textMuted: '#9AA8AB',
  onPrimary: '#FFFFFF',
  danger: '#FB403F',
};

export const lightColors = lightPalette;
export const darkColors = darkPalette;

export type ColorPalette = typeof lightPalette;
