import { useSyncExternalStore } from 'react';
import { historyStore } from '../store/history.store';
import { latestResultStore } from '../store/latestResult.store';
import type { OcrResult } from '../capture.types';

/** Saved extractions, newest first. */
export function useHistory(): readonly OcrResult[] {
  return useSyncExternalStore(historyStore.subscribe, historyStore.read);
}

/** The latest capture of this session (kept even when history is off). */
export function useLatestResult(): OcrResult | null {
  return useSyncExternalStore(
    latestResultStore.subscribe,
    latestResultStore.read,
  );
}
