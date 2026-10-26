import { storage, StorageKeys } from '@/store/mmkv';
import {
  captureSettingsStore,
  DEFAULT_CAPTURE_SETTINGS,
  sanitizeCaptureSettings,
} from '../store/captureSettings.store';

afterEach(() => {
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('capture settings', () => {
  it('starts from the defaults', () => {
    expect(captureSettingsStore.read()).toEqual(DEFAULT_CAPTURE_SETTINGS);
  });

  it.each(['english', 'hindi', 'mixed'] as const)(
    'persists the %s OCR mode across restarts',
    mode => {
      captureSettingsStore.update({ ocrMode: mode });
      captureSettingsStore.resetCacheForTest(); // simulate an app restart
      expect(captureSettingsStore.read().ocrMode).toBe(mode);
    },
  );

  it('notifies subscribers on change', () => {
    const listener = jest.fn();
    const unsubscribe = captureSettingsStore.subscribe(listener);
    captureSettingsStore.update({ autoCopy: false });
    unsubscribe();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ autoCopy: false }),
    );
  });

  it('rejects invalid values field by field', () => {
    expect(
      sanitizeCaptureSettings({
        ocrMode: 'tamil',
        autoCopy: 'yes',
        saveHistory: false,
        bubbleSizeDp: 500,
        bubbleOpacity: -1,
      }),
    ).toEqual({
      ...DEFAULT_CAPTURE_SETTINGS,
      saveHistory: false,
      bubbleSizeDp: 80,
      bubbleOpacity: 0.3,
    });
  });

  it('recovers from corrupt stored JSON', () => {
    storage.set(StorageKeys.CaptureSettings, '{not json');
    expect(captureSettingsStore.read()).toEqual(DEFAULT_CAPTURE_SETTINGS);
  });
});
