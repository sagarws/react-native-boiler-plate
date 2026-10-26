import type { OcrResult } from '../capture.types';

type Listener = (result: OcrResult | null) => void;
const listeners = new Set<Listener>();
let latest: OcrResult | null = null;

/**
 * The most recent capture, in memory only. Lets the user review the last
 * extraction even with history off; never written to storage.
 */
export const latestResultStore = {
  read(): OcrResult | null {
    return latest;
  },
  set(result: OcrResult | null): void {
    if (result?.id === latest?.id && result?.text === latest?.text) return;
    latest = result;
    for (const listener of listeners) listener(result);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
