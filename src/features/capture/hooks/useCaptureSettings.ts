import { useCallback, useSyncExternalStore } from 'react';
import { captureSettingsStore } from '../store/captureSettings.store';
import type {
  CaptureSettings,
  PaginationSettings,
  RefineSettings,
  TranslateSettings,
  ReadingSettings,
  SpeechSettings,
} from '../capture.types';

export interface UseCaptureSettings {
  settings: CaptureSettings;
  update: (patch: Partial<CaptureSettings>) => void;
  updateSpeech: (patch: Partial<SpeechSettings>) => void;
  updateReading: (patch: Partial<ReadingSettings>) => void;
  updatePagination: (patch: Partial<PaginationSettings>) => void;
  updateTranslate: (patch: Partial<TranslateSettings>) => void;
  updateRefine: (patch: Partial<RefineSettings>) => void;
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
  const updateSpeech = useCallback((patch: Partial<SpeechSettings>) => {
    captureSettingsStore.updateSpeech(patch);
  }, []);
  const updateReading = useCallback((patch: Partial<ReadingSettings>) => {
    captureSettingsStore.updateReading(patch);
  }, []);
  const updatePagination = useCallback((patch: Partial<PaginationSettings>) => {
    captureSettingsStore.updatePagination(patch);
  }, []);
  const updateTranslate = useCallback((patch: Partial<TranslateSettings>) => {
    captureSettingsStore.updateTranslate(patch);
  }, []);
  const updateRefine = useCallback((patch: Partial<RefineSettings>) => {
    captureSettingsStore.updateRefine(patch);
  }, []);
  return {
    settings,
    update,
    updateSpeech,
    updateReading,
    updatePagination,
    updateTranslate,
    updateRefine,
  };
}
