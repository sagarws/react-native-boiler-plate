import { useCallback, useSyncExternalStore } from 'react';
import { captureSettingsStore } from '../store/captureSettings.store';
import type { CaptureSettings } from '../capture.types';

export interface UseCaptureSettings {
  settings: CaptureSettings;
  update: (patch: Partial<CaptureSettings>) => void;
}

/** Live capture settings; `update` persists and notifies every subscriber. */
export function useCaptureSettings(): UseCaptureSettings {
  const settings = useSyncExternalStore(
    captureSettingsStore.subscribe,
    captureSettingsStore.read,
  );
  const update = useCallback((patch: Partial<CaptureSettings>) => {
    captureSettingsStore.update(patch);
  }, []);
  return { settings, update };
}
