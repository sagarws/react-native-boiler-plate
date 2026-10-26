import { DeviceEventEmitter } from 'react-native';
import { storage } from '@/store/mmkv';
import { screenOcrService } from '../services/screenOcr.service';
import {
  clearAllCaptures,
  syncCaptures,
} from '../services/captureSync.service';
import {
  captureSettingsStore,
  DEFAULT_CAPTURE_SETTINGS,
} from '../store/captureSettings.store';
import { historyStore } from '../store/history.store';
import { latestResultStore } from '../store/latestResult.store';

// Built inside the factory: jest.mock is hoisted above the imports, so a
// module-scope mock object would not exist yet when the service loads.
jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getStatus: jest.fn(),
    openOverlaySettings: jest.fn(),
    startOverlay: jest.fn(),
    stopOverlay: jest.fn(),
    updateConfig: jest.fn(),
    resetBubblePosition: jest.fn(),
    copyToClipboard: jest.fn(),
    getLatestResult: jest.fn(),
    consumePendingResults: jest.fn(),
    clearCapturedData: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const HINDI = 'आपका Order Successfully Shipped हो गया है।';

function entry(id: string, text = HINDI, mode = 'mixed') {
  return {
    id,
    text,
    mode,
    createdAt: Date.now(),
    durationMs: 350,
    lineCount: 1,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.getLatestResult.mockResolvedValue('');
  mockNative.consumePendingResults.mockResolvedValue('[]');
});

afterEach(() => {
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
  historyStore.resetCacheForTest();
  latestResultStore.set(null);
});

describe('enable / disable', () => {
  it('reports started when the user grants capture consent', async () => {
    mockNative.startOverlay.mockResolvedValue(true);
    await expect(screenOcrService.enable()).resolves.toBe('started');
  });

  it('reports cancelled when the user declines consent', async () => {
    mockNative.startOverlay.mockResolvedValue(false);
    await expect(screenOcrService.enable()).resolves.toBe('cancelled');
  });

  it('reports a missing overlay permission', async () => {
    mockNative.startOverlay.mockRejectedValue(
      Object.assign(new Error('no'), { code: 'overlay_permission' }),
    );
    await expect(screenOcrService.enable()).resolves.toBe('overlay_permission');
  });

  it('recovers from an unexpected native failure', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockNative.startOverlay.mockRejectedValue(new Error('boom'));
    await expect(screenOcrService.enable()).resolves.toBe('error');
    spy.mockRestore();
  });

  it('stops the service on disable', () => {
    screenOcrService.disable();
    expect(mockNative.stopOverlay).toHaveBeenCalledTimes(1);
  });

  it('marks the status as supported', async () => {
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: true,
      serviceRunning: false,
    });
    await expect(screenOcrService.getStatus()).resolves.toEqual({
      supported: true,
      overlayPermission: true,
      serviceRunning: false,
    });
  });
});

describe('OCR mode selection reaches the native engine', () => {
  it.each(['english', 'hindi', 'mixed'] as const)(
    'pushes %s with the theme colours',
    mode => {
      screenOcrService.pushConfig(
        { ...DEFAULT_CAPTURE_SETTINGS, ocrMode: mode },
        { background: '#7C3AED', icon: '#FFFFFF' },
      );
      expect(mockNative.updateConfig).toHaveBeenCalledWith({
        ocrMode: mode,
        autoCopy: true,
        saveHistory: true,
        bubbleSizeDp: 56,
        bubbleOpacity: 0.9,
        bubbleColor: '#7C3AED',
        bubbleIconColor: '#FFFFFF',
      });
    },
  );
});

describe('clipboard', () => {
  it('passes Hindi + English Unicode through unchanged', async () => {
    mockNative.copyToClipboard.mockResolvedValue(true);
    await expect(screenOcrService.copy(HINDI)).resolves.toBe(true);
    expect(mockNative.copyToClipboard).toHaveBeenCalledWith(HINDI);
  });

  it('never writes empty text to the clipboard', async () => {
    await expect(screenOcrService.copy('')).resolves.toBe(false);
    expect(mockNative.copyToClipboard).not.toHaveBeenCalled();
  });

  it('reports clipboard failure instead of throwing', async () => {
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockNative.copyToClipboard.mockRejectedValue(new Error('denied'));
    await expect(screenOcrService.copy('abc')).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe('syncing background captures', () => {
  it('saves queued captures to history when history is on', async () => {
    mockNative.consumePendingResults.mockResolvedValue(
      JSON.stringify([entry('a'), entry('b')]),
    );
    mockNative.getLatestResult.mockResolvedValue(JSON.stringify(entry('b')));

    await syncCaptures();

    expect(
      historyStore
        .read()
        .map(r => r.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(latestResultStore.read()?.text).toBe(HINDI);
  });

  it('does not save anything when history is off, but keeps the latest in memory', async () => {
    captureSettingsStore.update({ saveHistory: false });
    mockNative.consumePendingResults.mockResolvedValue(
      JSON.stringify([entry('a')]),
    );
    mockNative.getLatestResult.mockResolvedValue(JSON.stringify(entry('a')));

    await syncCaptures();

    expect(historyStore.read()).toEqual([]);
    expect(latestResultStore.read()?.id).toBe('a');
  });

  it('clears history on both sides', () => {
    historyStore.add([entry('a') as never]);
    clearAllCaptures();
    expect(historyStore.read()).toEqual([]);
    expect(mockNative.clearCapturedData).toHaveBeenCalled();
  });

  it('forwards native result events and unsubscribes cleanly', () => {
    const listener = jest.fn();
    const unsubscribe = screenOcrService.onResult(listener);
    DeviceEventEmitter.emit('ScreenOcrResult');
    unsubscribe();
    DeviceEventEmitter.emit('ScreenOcrResult');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
