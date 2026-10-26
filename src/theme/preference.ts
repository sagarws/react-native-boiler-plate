import { storage, StorageKeys } from '@/store/mmkv';

export type ThemePreference = 'system' | 'light' | 'dark';

type Listener = (pref: ThemePreference) => void;
const listeners = new Set<Listener>();

/**
 * Defaults to light rather than following the OS.
 *
 * The bundled artwork is drawn on a white ground, so light is the safe
 * default. Users can still choose dark or system in Settings; change the
 * fallback below to 'system' once your assets work on both.
 */
function read(): ThemePreference {
  const raw = storage.getString(StorageKeys.ThemePreference);
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'light';
}

export const themePreference = {
  read,
  set(pref: ThemePreference): void {
    storage.set(StorageKeys.ThemePreference, pref);
    for (const l of listeners) l(pref);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
