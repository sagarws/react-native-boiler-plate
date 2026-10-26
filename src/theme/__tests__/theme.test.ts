import { storage, StorageKeys } from '@/store/mmkv';
import {
  buildPalette,
  buildTypography,
  createTheme,
  lightColors,
  resolveScheme,
  themePreference,
  themePresetPreference,
  THEME_PRESET_IDS,
  typographyPreference,
  type ColorScheme,
} from '@/theme';

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SCHEMES: ColorScheme[] = ['light', 'dark'];

afterEach(() => storage.clearAll());

describe('colour presets', () => {
  it('ships exactly the six required presets', () => {
    expect(THEME_PRESET_IDS).toEqual([
      'violet',
      'midnightViolet',
      'oceanBlue',
      'emerald',
      'rose',
      'amber',
    ]);
  });

  it('defaults to the violet brand colour from the design brief', () => {
    expect(lightColors.primary).toBe('#7C3AED');
    expect(lightColors.background).toBe('#F8F7FC');
    expect(buildPalette('violet', 'dark').background).toBe('#11101A');
  });

  it.each(THEME_PRESET_IDS.flatMap(id => SCHEMES.map(s => [id, s] as const)))(
    '%s / %s resolves every semantic token',
    (id, scheme) => {
      const palette = buildPalette(id, scheme);
      expect(Object.keys(palette).sort()).toEqual(
        Object.keys(lightColors).sort(),
      );
      for (const value of Object.values(palette)) expect(value).toBeTruthy();
    },
  );

  it.each(THEME_PRESET_IDS.flatMap(id => SCHEMES.map(s => [id, s] as const)))(
    '%s / %s keeps text readable (WCAG AA)',
    (id, scheme) => {
      const p = buildPalette(id, scheme);
      expect(contrast(p.primaryForeground, p.primary)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(p.textPrimary, p.background)).toBeGreaterThanOrEqual(7);
      expect(contrast(p.textSecondary, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.primaryText, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.primaryText, p.primarySoft)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});

describe('theme settings persistence', () => {
  it('persists the selected preset and notifies subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = themePresetPreference.subscribe(listener);
    themePresetPreference.set('rose');
    unsubscribe();

    expect(listener).toHaveBeenCalledWith('rose');
    expect(storage.getString(StorageKeys.ThemePreset)).toBe('rose');
    expect(themePresetPreference.read()).toBe('rose');
  });

  it('falls back to safe defaults for missing or invalid stored values', () => {
    expect(themePresetPreference.read()).toBe('violet');
    expect(typographyPreference.read()).toBe('modern');
    expect(themePreference.read()).toBe('system');

    storage.set(StorageKeys.ThemePreset, 'neon');
    storage.set(StorageKeys.TypographyPreset, 'comic');
    storage.set(StorageKeys.ThemePreference, 'sepia');

    expect(themePresetPreference.read()).toBe('violet');
    expect(typographyPreference.read()).toBe('modern');
    expect(themePreference.read()).toBe('system');
  });

  it('persists light/dark mode', () => {
    themePreference.set('dark');
    expect(themePreference.read()).toBe('dark');
    expect(
      createTheme(themePreference.read(), false, 'violet', 'modern').scheme,
    ).toBe('dark');
  });
});

describe('light and dark mode', () => {
  it('resolves the scheme from the preference and the system', () => {
    expect(resolveScheme('light', true)).toBe('light');
    expect(resolveScheme('dark', false)).toBe('dark');
    expect(resolveScheme('system', true)).toBe('dark');
    expect(resolveScheme('system', false)).toBe('light');
  });

  it('builds a dark palette for dark mode', () => {
    const theme = createTheme('dark', false, 'oceanBlue', 'modern');
    expect(theme.colors).toEqual(buildPalette('oceanBlue', 'dark'));
  });
});

describe('typography presets', () => {
  it('Modern uses the bundled sans-serif, Classic the system serif', () => {
    expect(buildTypography('modern').body.fontFamily).toMatch(/^ReadexPro-/);
    expect(buildTypography('classic').body.fontFamily).toBe('serif');
  });

  it('applies the preset to every text role', () => {
    const classic = buildTypography('classic');
    for (const style of Object.values(classic))
      expect(style.fontFamily).toBe('serif');
  });

  it('persists the selected text style independently of the colour preset', () => {
    typographyPreference.set('classic');
    themePresetPreference.set('emerald');
    expect(typographyPreference.read()).toBe('classic');
    const theme = createTheme(
      'light',
      false,
      themePresetPreference.read(),
      typographyPreference.read(),
    );
    expect(theme.typographyPreset).toBe('classic');
    expect(theme.preset).toBe('emerald');
    expect(theme.typography.reading.fontFamily).toBe('serif');
  });
});
