// App palettes. Every colour the UI draws resolves through `buildPalette`,
// which combines a neutral base (per light/dark scheme) with the brand colours
// of the selected preset. Light and dark palettes share identical keys, so
// `useTheme().colors` always resolves every token.

export type ColorScheme = 'light' | 'dark';

export const THEME_PRESET_IDS = [
  'violet',
  'midnightViolet',
  'oceanBlue',
  'emerald',
  'rose',
  'amber',
] as const;

export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

export const DEFAULT_THEME_PRESET: ThemePresetId = 'violet';

/** Brand colours a preset contributes to one scheme. */
interface BrandColors {
  primary: string;
  primaryPressed: string;
  /** Text and icons drawn on `primary`. */
  primaryForeground: string;
  /** Brand-coloured text on `background` / `surface` (links, active labels). */
  primaryText: string;
  /** Tinted fill for selected chips, icon wells and soft highlights. */
  primarySoft: string;
  secondary: string;
  accent: string;
}

interface NeutralColors {
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  placeholder: string;
  success: string;
  warning: string;
  error: string;
  overlay: string;
  disabled: string;
  disabledForeground: string;
}

const neutralLight: NeutralColors = {
  background: '#F8F7FC',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EEF8',
  border: '#E8E3F0',
  textPrimary: '#211D2B',
  textSecondary: '#6B6578',
  placeholder: '#8E889C',
  success: '#15803D',
  warning: '#B45309',
  error: '#DC2626',
  overlay: 'rgba(17,16,26,0.5)',
  disabled: '#E4E0EC',
  disabledForeground: '#8E889C',
};

const neutralDark: NeutralColors = {
  background: '#11101A',
  surface: '#1C1928',
  surfaceMuted: '#262236',
  border: '#2E2A3D',
  textPrimary: '#F3F1F8',
  textSecondary: '#A9A3B8',
  placeholder: '#7C768F',
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#F87171',
  overlay: 'rgba(0,0,0,0.6)',
  disabled: '#2F2A40',
  disabledForeground: '#7C768F',
};

export interface ThemePreset {
  id: ThemePresetId;
  light: BrandColors;
  dark: BrandColors;
  /** Optional neutral overrides, for presets that tint the whole surface. */
  neutral?: { light?: Partial<NeutralColors>; dark?: Partial<NeutralColors> };
}

export const themePresets: Record<ThemePresetId, ThemePreset> = {
  violet: {
    id: 'violet',
    light: {
      primary: '#7C3AED',
      primaryPressed: '#6D28D9',
      primaryForeground: '#FFFFFF',
      primaryText: '#6D28D9',
      primarySoft: '#EFE7FD',
      secondary: '#EDE9FE',
      accent: '#C026D3',
    },
    dark: {
      primary: '#7C3AED',
      primaryPressed: '#6D28D9',
      primaryForeground: '#FFFFFF',
      primaryText: '#C4B5FD',
      primarySoft: '#2A2045',
      secondary: '#2A2045',
      accent: '#E879F9',
    },
  },
  midnightViolet: {
    id: 'midnightViolet',
    light: {
      primary: '#5B21B6',
      primaryPressed: '#4C1D95',
      primaryForeground: '#FFFFFF',
      primaryText: '#5B21B6',
      primarySoft: '#EAE4F7',
      secondary: '#E4DDF5',
      accent: '#4338CA',
    },
    dark: {
      primary: '#6D28D9',
      primaryPressed: '#5B21B6',
      primaryForeground: '#FFFFFF',
      primaryText: '#C4B5FD',
      primarySoft: '#221A3D',
      secondary: '#221A3D',
      accent: '#818CF8',
    },
    neutral: {
      light: { background: '#F4F2FB', surfaceMuted: '#ECE8F7' },
      dark: {
        background: '#0B0A16',
        surface: '#15122A',
        surfaceMuted: '#1E1A36',
        border: '#2A2545',
      },
    },
  },
  oceanBlue: {
    id: 'oceanBlue',
    light: {
      primary: '#2563EB',
      primaryPressed: '#1D4ED8',
      primaryForeground: '#FFFFFF',
      primaryText: '#1D4ED8',
      primarySoft: '#E3ECFD',
      secondary: '#DBEAFE',
      accent: '#0891B2',
    },
    dark: {
      primary: '#2563EB',
      primaryPressed: '#1D4ED8',
      primaryForeground: '#FFFFFF',
      primaryText: '#93C5FD',
      primarySoft: '#172A4A',
      secondary: '#172A4A',
      accent: '#22D3EE',
    },
  },
  emerald: {
    id: 'emerald',
    light: {
      primary: '#047857',
      primaryPressed: '#065F46',
      primaryForeground: '#FFFFFF',
      primaryText: '#047857',
      primarySoft: '#DDF3EA',
      secondary: '#D1FAE5',
      accent: '#0D9488',
    },
    dark: {
      primary: '#047857',
      primaryPressed: '#065F46',
      primaryForeground: '#FFFFFF',
      primaryText: '#6EE7B7',
      primarySoft: '#12322A',
      secondary: '#12322A',
      accent: '#2DD4BF',
    },
  },
  rose: {
    id: 'rose',
    light: {
      primary: '#E11D48',
      primaryPressed: '#BE123C',
      primaryForeground: '#FFFFFF',
      primaryText: '#BE123C',
      primarySoft: '#FDE6EC',
      secondary: '#FFE4E6',
      accent: '#DB2777',
    },
    dark: {
      primary: '#E11D48',
      primaryPressed: '#BE123C',
      primaryForeground: '#FFFFFF',
      primaryText: '#FDA4AF',
      primarySoft: '#3A1622',
      secondary: '#3A1622',
      accent: '#F472B6',
    },
  },
  amber: {
    id: 'amber',
    // Amber is too light for white text, so it carries dark foreground text.
    light: {
      primary: '#F59E0B',
      primaryPressed: '#D97706',
      primaryForeground: '#241600',
      primaryText: '#92400E',
      primarySoft: '#FEF1D6',
      secondary: '#FEF3C7',
      accent: '#EA580C',
    },
    dark: {
      primary: '#F59E0B',
      primaryPressed: '#D97706',
      primaryForeground: '#241600',
      primaryText: '#FCD34D',
      primarySoft: '#3A2A0E',
      secondary: '#3A2A0E',
      accent: '#FB923C',
    },
  },
};

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return (
    typeof value === 'string' &&
    (THEME_PRESET_IDS as readonly string[]).includes(value)
  );
}

export function buildPalette(presetId: ThemePresetId, scheme: ColorScheme) {
  const preset = themePresets[presetId] ?? themePresets[DEFAULT_THEME_PRESET];
  const brand = preset[scheme];
  const n: NeutralColors = {
    ...(scheme === 'dark' ? neutralDark : neutralLight),
    ...preset.neutral?.[scheme],
  };
  const onError = '#FFFFFF';

  return {
    // Semantic tokens — use these in new code.
    primary: brand.primary,
    primaryPressed: brand.primaryPressed,
    primaryForeground: brand.primaryForeground,
    primaryText: brand.primaryText,
    primarySoft: brand.primarySoft,
    secondary: brand.secondary,
    secondaryForeground: brand.primaryText,
    accent: brand.accent,
    accentForeground: brand.primaryText,
    background: n.background,
    surface: n.surface,
    surfaceMuted: n.surfaceMuted,
    card: n.surface,
    cardForeground: n.textPrimary,
    border: n.border,
    divider: n.border,
    textPrimary: n.textPrimary,
    textSecondary: n.textSecondary,
    placeholder: n.placeholder,
    success: n.success,
    warning: n.warning,
    error: n.error,
    errorForeground: onError,
    overlay: n.overlay,
    disabled: n.disabled,
    disabledForeground: n.disabledForeground,

    // Boilerplate names, kept so existing components keep compiling. They
    // alias the semantic tokens above, so they follow the active theme too.
    foreground: n.textPrimary,
    surface2: n.surfaceMuted,
    popover: n.surface,
    popoverForeground: n.textPrimary,
    muted: n.surfaceMuted,
    mutedForeground: n.textSecondary,
    destructive: n.error,
    destructiveForeground: onError,
    input: n.border,
    inputBorder: n.border,
    ring: brand.primary,
    sidebar: brand.primary,
    sidebarForeground: brand.primaryForeground,
    sidebarAccent: n.surface,
    sidebarBorder: n.border,
    good: n.success,
    bad: n.error,
    red: n.error,
    danger: n.error,
    grey: n.textSecondary,
    lightGrey: n.disabled,
    scrim: n.overlay,
    text: n.textPrimary,
    textMuted: n.textSecondary,
    onPrimary: brand.primaryForeground,
  };
}

export type ColorPalette = ReturnType<typeof buildPalette>;

export const lightColors: ColorPalette = buildPalette(
  DEFAULT_THEME_PRESET,
  'light',
);
export const darkColors: ColorPalette = buildPalette(
  DEFAULT_THEME_PRESET,
  'dark',
);

/**
 * User-selectable colours for Manage Life projects and tasks. Mid-tone hues
 * that keep white icons/text readable on top and stay visible on both light
 * and dark surfaces.
 */
export const categoryPalette = {
  violet: '#7C3AED',
  indigo: '#4F46E5',
  blue: '#2563EB',
  teal: '#0F766E',
  emerald: '#15803D',
  amber: '#B45309',
  orange: '#C2410C',
  rose: '#E11D48',
  pink: '#BE185D',
  slate: '#475569',
} as const;

export type CategoryColor = keyof typeof categoryPalette;

export const CATEGORY_COLORS = Object.keys(categoryPalette) as CategoryColor[];

/** The palette colour for [key], falling back to violet for unknown keys. */
export function categoryColor(key: string): string {
  return (
    (categoryPalette as Record<string, string>)[key] ?? categoryPalette.violet
  );
}
