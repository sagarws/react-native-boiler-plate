import { useSyncExternalStore } from 'react';
import { storage, StorageKeys } from '@/store/mmkv';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Whether the one-time setup has been finished on this device. */
export const onboardingStore = {
  isComplete(): boolean {
    return storage.getBoolean(StorageKeys.OnboardingComplete) === true;
  },
  complete(): void {
    storage.set(StorageKeys.OnboardingComplete, true);
    for (const listener of listeners) listener();
  },
  reset(): void {
    storage.delete(StorageKeys.OnboardingComplete);
    for (const listener of listeners) listener();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useOnboardingComplete(): boolean {
  return useSyncExternalStore(
    onboardingStore.subscribe,
    onboardingStore.isComplete,
  );
}
