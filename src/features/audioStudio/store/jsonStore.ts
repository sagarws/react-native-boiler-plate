import { storage } from '@/store/mmkv';

/**
 * A small subscribable JSON value in MMKV: read once (cached), every update
 * written through and broadcast. `clean` repairs whatever is stored (older
 * shapes, corruption) into a valid value.
 */
export function createJsonStore<T>(key: string, clean: (raw: unknown) => T) {
  const listeners = new Set<() => void>();
  let cache: T | null = null;

  const read = (): T => {
    if (cache === null) {
      try {
        cache = clean(JSON.parse(storage.getString(key) ?? 'null'));
      } catch {
        cache = clean(null);
      }
    }
    return cache;
  };

  return {
    read,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T): T {
      cache = next;
      storage.set(key, JSON.stringify(next));
      listeners.forEach(l => l());
      return next;
    },
    update(fn: (current: T) => T): T {
      return this.set(fn(read()));
    },
    resetCacheForTest() {
      cache = null;
      listeners.clear();
    },
  };
}
