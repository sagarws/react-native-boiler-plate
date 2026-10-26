import { storage, StorageKeys } from '@/store/mmkv';
import { historyStore, MAX_HISTORY } from '../store/history.store';
import type { OcrResult } from '../capture.types';

function result(id: string, createdAt: number, text = `text ${id}`): OcrResult {
  return { id, text, mode: 'mixed', createdAt, durationMs: 300, lineCount: 1 };
}

afterEach(() => {
  storage.clearAll();
  historyStore.resetCacheForTest();
});

describe('history store', () => {
  it('keeps entries newest first and de-duplicates by id', () => {
    historyStore.add([result('a', 1)]);
    historyStore.add([result('b', 3), result('a', 1)]);
    historyStore.add([result('c', 2)]);
    expect(historyStore.read().map(r => r.id)).toEqual(['b', 'c', 'a']);
  });

  it(`caps history at ${MAX_HISTORY} entries`, () => {
    historyStore.add(
      Array.from({ length: MAX_HISTORY + 5 }, (_, i) => result(`r${i}`, i)),
    );
    const ids = historyStore.read().map(r => r.id);
    expect(ids).toHaveLength(MAX_HISTORY);
    expect(ids[0]).toBe(`r${MAX_HISTORY + 4}`);
  });

  it('survives a restart with Hindi text intact', () => {
    const hindi = 'आपका Order Successfully Shipped हो गया है।';
    historyStore.add([result('h', 1, hindi)]);
    historyStore.resetCacheForTest();
    expect(historyStore.find('h')?.text).toBe(hindi);
  });

  it('updates edited text and line count', () => {
    historyStore.add([result('a', 1)]);
    historyStore.updateText('a', 'line one\nline two');
    expect(historyStore.find('a')).toMatchObject({
      text: 'line one\nline two',
      lineCount: 2,
    });
  });

  it('removes one entry and clears all', () => {
    historyStore.add([result('a', 1), result('b', 2)]);
    historyStore.remove('a');
    expect(historyStore.read().map(r => r.id)).toEqual(['b']);
    historyStore.clear();
    expect(historyStore.read()).toEqual([]);
    expect(storage.contains(StorageKeys.CaptureHistory)).toBe(false);
  });

  it('drops malformed stored entries', () => {
    storage.set(
      StorageKeys.CaptureHistory,
      JSON.stringify([result('ok', 1), { id: 'bad' }, 'junk']),
    );
    expect(historyStore.read().map(r => r.id)).toEqual(['ok']);
  });
});
