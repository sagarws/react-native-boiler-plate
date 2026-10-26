import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';
import {
  buildPalette,
  buildTypography,
  fontFamily,
  radius,
  shadows,
  spacing,
  zIndex,
  type ColorPalette,
  type ColorScheme,
  type ThemePresetId,
  type Typography,
  type TypographyPresetId,
} from './tokens';
import {
  themePreference,
  themePresetPreference,
  typographyPreference,
  type ThemePreference,
} from './preference';

export type Theme = {
  scheme: ColorScheme;
  preference: ThemePreference;
  preset: ThemePresetId;
  typographyPreset: TypographyPresetId;
  colors: ColorPalette;
  spacing: typeof spacing;
  typography: Typography;
  fontFamily: typeof fontFamily;
  radius: typeof radius;
  shadows: typeof shadows;
  zIndex: typeof zIndex;
};

export function resolveScheme(
  pref: ThemePreference,
  systemDark: boolean,
): ColorScheme {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function createTheme(
  preference: ThemePreference,
  systemDark: boolean,
  preset: ThemePresetId,
  typographyPreset: TypographyPresetId,
): Theme {
  const scheme = resolveScheme(preference, systemDark);
  return {
    scheme,
    preference,
    preset,
    typographyPreset,
    colors: buildPalette(preset, scheme),
    spacing,
    typography: buildTypography(typographyPreset),
    fontFamily,
    radius,
    shadows,
    zIndex,
  };
}

/** Subscribes to every persisted theme setting and the system scheme. */
function useThemeSettings(): Theme {
  const systemDark = useColorScheme() === 'dark';
  const [preference, setPreference] = useState(themePreference.read);
  const [preset, setPreset] = useState(themePresetPreference.read);
  const [typographyPreset, setTypographyPreset] = useState(
    typographyPreference.read,
  );

  useEffect(() => themePreference.subscribe(setPreference), []);
  useEffect(() => themePresetPreference.subscribe(setPreset), []);
  useEffect(() => typographyPreference.subscribe(setTypographyPreset), []);

  return useMemo(
    () => createTheme(preference, systemDark, preset, typographyPreset),
    [preference, systemDark, preset, typographyPreset],
  );
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * Computes the theme once for the whole tree. A change to the mode, colour
 * preset or type preset re-renders every consumer immediately — no restart.
 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const theme = useThemeSettings();
  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}

/** Snapshot of the stored settings, for components rendered without a provider. */
function storedTheme(): Theme {
  return createTheme(
    themePreference.read(),
    false,
    themePresetPreference.read(),
    typographyPreference.read(),
  );
}

/**
 * The active theme. Outside a `ThemeProvider` (isolated component tests) it
 * falls back to a snapshot of the stored settings, so components never need a
 * provider just to render; only the provider reacts to changes.
 */
export function useTheme(): Theme {
  const fromContext = useContext(ThemeContext);
  return fromContext ?? storedTheme();
}
