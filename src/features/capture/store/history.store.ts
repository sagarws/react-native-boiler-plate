import { storage, StorageKeys } from '@/store/mmkv';
import { parseOcrResult } from '../utils/parseResult';
import type { OcrResult } from '../capture.types';

/** Newest entries kept; older ones fall off. */
export const MAX_HISTORY = 50;

const EMPTY: readonly OcrResult[] = [];

function load(): readonly OcrResult[] {
  const raw = storage.getString(StorageKeys.CaptureHistory);
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.map(parseOcrResult).filter((r): r is OcrResult => r !== null);
  } catch {
    return EMPTY;
  }
}

type Listener = (entries: readonly OcrResult[]) => void;
const listeners = new Set<Listener>();
let cache: readonly OcrResult[] | null = null;

function commit(next: readonly OcrResult[]): void {
  cache = next;
  if (next.length === 0) storage.delete(StorageKeys.CaptureHistory);
  else storage.set(StorageKeys.CaptureHistory, JSON.stringify(next));
  for (const listener of listeners) listener(next);
}

/**
 * Extraction history, stored only on this device and only while the user has
 * "Save history" on. Newest first, de-duplicated by id.
 */
export const historyStore = {
  read(): readonly OcrResult[] {
    if (!cache) cache = load();
    return cache;
  },
  find(id: string): OcrResult | undefined {
    return historyStore.read().find(entry => entry.id === id);
  },
  add(entries: readonly OcrResult[]): void {
    if (entries.length === 0) return;
    const incoming = new Set(entries.map(e => e.id));
    const merged = [
      ...entries,
      ...historyStore.read().filter(e => !incoming.has(e.id)),
    ]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_HISTORY);
    commit(merged);
  },
  updateText(id: string, text: string): void {
    const current = historyStore.read();
    if (!current.some(e => e.id === id)) return;
    commit(
      current.map(e =>
        e.id === id
          ? {
              ...e,
              text,
              lineCount: text.length === 0 ? 0 : text.split('\n').length,
            }
          : e,
      ),
    );
  },
  remove(id: string): void {
    commit(historyStore.read().filter(e => e.id !== id));
  },
  clear(): void {
    commit(EMPTY);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  resetCacheForTest(): void {
    cache = null;
  },
};
