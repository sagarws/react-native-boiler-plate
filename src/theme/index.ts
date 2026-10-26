import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import {
  lightColors,
  darkColors,
  spacing,
  typography,
  fontFamily,
  radius,
  shadows,
  zIndex,
  type ColorPalette,
} from './tokens';
import { themePreference, type ThemePreference } from './preference';

export type Theme = {
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  colors: ColorPalette;
  spacing: typeof spacing;
  typography: typeof typography;
  fontFamily: typeof fontFamily;
  radius: typeof radius;
  shadows: typeof shadows;
  zIndex: typeof zIndex;
};

function resolveScheme(
  pref: ThemePreference,
  systemDark: boolean,
): 'light' | 'dark' {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return systemDark ? 'dark' : 'light';
}

export function useTheme(): Theme {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>(() =>
    themePreference.read(),
  );

  useEffect(() => themePreference.subscribe(setPreference), []);

  const scheme = resolveScheme(preference, systemScheme === 'dark');
  return {
    scheme,
    preference,
    colors: scheme === 'dark' ? darkColors : lightColors,
    spacing,
    typography,
    fontFamily,
    radius,
    shadows,
    zIndex,
  };
}

export { themePreference, type ThemePreference } from './preference';
export * from './tokens';
