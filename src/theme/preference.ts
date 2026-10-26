import { storage, StorageKeys } from '@/store/mmkv';
import {
  DEFAULT_THEME_PRESET,
  DEFAULT_TYPOGRAPHY_PRESET,
  isThemePresetId,
  isTypographyPresetId,
  type ThemePresetId,
  type TypographyPresetId,
} from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';

/**
 * A small persisted value with change listeners. Every theme setting is one
 * of these, so React (through `ThemeProvider`) and non-React callers share
 * one source of truth. Invalid or missing stored values fall back to the
 * default, so a corrupt key can never leave the app unthemed.
 */
function persistedSetting<T extends string>(
  key: string,
  isValid: (value: unknown) => value is T,
  fallback: T,
) {
  const listeners = new Set<(value: T) => void>();

  function read(): T {
    const raw = storage.getString(key);
    return isValid(raw) ? raw : fallback;
  }

  return {
    read,
    set(value: T): void {
      const next = isValid(value) ? value : fallback;
      storage.set(key, next);
      for (const listener of listeners) listener(next);
    },
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Light / dark / follow the system. */
export const themePreference = persistedSetting<ThemePreference>(
  StorageKeys.ThemePreference,
  isThemePreference,
  'system',
);

/** Brand colour preset. */
export const themePresetPreference = persistedSetting<ThemePresetId>(
  StorageKeys.ThemePreset,
  isThemePresetId,
  DEFAULT_THEME_PRESET,
);

/** Modern or Classic type. Independent of the OCR language. */
export const typographyPreference = persistedSetting<TypographyPresetId>(
  StorageKeys.TypographyPreset,
  isTypographyPresetId,
  DEFAULT_TYPOGRAPHY_PRESET,
);
