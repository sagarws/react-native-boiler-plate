import { storage } from '@/store/mmkv';
import {
  paginationService,
  parseTargetStatus,
} from '../services/pagination.service';
import { buildNativeConfig } from '../services/screenOcr.service';
import {
  captureSettingsStore,
  DEFAULT_CAPTURE_SETTINGS,
  DEFAULT_PAGINATION_SETTINGS,
  sanitizeCaptureSettings,
} from '../store/captureSettings.store';
import { FLOATING_ACTIONS } from '../capture.types';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getPaginationTarget: jest.fn(),
    clearPaginationTarget: jest.fn(),
    startTargetCalibration: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const PINNED = {
  x: 980,
  y: 2180,
  anchor: 'screen',
  coordinateSpace: 'physical_screen_px',
  packageName: 'com.example.reader',
  calibratedAt: 1730000000000,
  geometry: { widthPx: 1080, heightPx: 2340, densityDpi: 450, rotation: 0 },
  node: {
    viewId: 'com.example.reader:id/next',
    contentDescription: '',
    text: '',
  },
  problem: 'none',
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('fourth action', () => {
  it('adds Speak with pagination after the existing three, unchanged', () => {
    expect(FLOATING_ACTIONS.slice(0, 4)).toEqual([
      'copy',
      'speak',
      'speak_scroll',
      'speak_pagination',
    ]);
  });

  it('persists the pagination action and settings across restarts', () => {
    captureSettingsStore.update({ action: 'speak_pagination' });
    captureSettingsStore.updatePagination({
      pageLoadDelayMs: 2000,
      maxPages: 12,
    });
    captureSettingsStore.resetCacheForTest();
    const s = captureSettingsStore.read();
    expect(s.action).toBe('speak_pagination');
    expect(s.pagination).toEqual({
      ...DEFAULT_PAGINATION_SETTINGS,
      pageLoadDelayMs: 2000,
      maxPages: 12,
    });
  });

  it('validates pagination limits and fills them for older saved settings', () => {
    const s = sanitizeCaptureSettings({
      pagination: { pageLoadDelayMs: 1, verifyTimeoutMs: 999999, maxPages: -4 },
    });
    expect(s.pagination).toEqual({
      pageLoadDelayMs: 500,
      verifyTimeoutMs: 20000,
      maxPages: 1,
    });
    expect(
      sanitizeCaptureSettings({ action: 'speak_scroll' }).pagination,
    ).toEqual(DEFAULT_PAGINATION_SETTINGS);
  });

  it('sends pagination settings to the native service', () => {
    const config = buildNativeConfig(
      { ...DEFAULT_CAPTURE_SETTINGS, action: 'speak_pagination' },
      { background: '#7C3AED', icon: '#FFF', panel: '#000', panelText: '#FFF' },
    );
    expect(config.action).toBe('speak_pagination');
    expect(config.pagination).toEqual(DEFAULT_PAGINATION_SETTINGS);
  });
});

describe('pinned target', () => {
  it('parses the native report, including whether an exact node was recorded', () => {
    expect(parseTargetStatus(JSON.stringify(PINNED))).toEqual({
      x: 980,
      y: 2180,
      anchor: 'screen',
      packageName: 'com.example.reader',
      calibratedAt: 1730000000000,
      hasNode: true,
      problem: 'none',
    });
  });

  it('reports a target invalidated by a screen change', () => {
    const rotated = parseTargetStatus(
      JSON.stringify({ ...PINNED, problem: 'rotated' }),
    );
    expect(rotated?.problem).toBe('rotated');
  });

  it('never treats a malformed or unknown report as usable', () => {
    expect(parseTargetStatus('')).toBeNull();
    expect(parseTargetStatus('{oops')).toBeNull();
    expect(parseTargetStatus('{"anchor":"screen"}')).toBeNull();
    expect(
      parseTargetStatus(JSON.stringify({ ...PINNED, problem: 'weird' }))
        ?.problem,
    ).toBe('out_of_bounds');
  });

  it('reads, clears and calibrates through the native module', async () => {
    mockNative.getPaginationTarget.mockResolvedValue(JSON.stringify(PINNED));
    await expect(paginationService.getTarget()).resolves.toMatchObject({
      x: 980,
    });

    paginationService.clearTarget();
    expect(mockNative.clearPaginationTarget).toHaveBeenCalled();

    mockNative.startTargetCalibration.mockResolvedValue('not_running');
    await expect(paginationService.startCalibration()).resolves.toBe(
      'not_running',
    );
    mockNative.startTargetCalibration.mockResolvedValue('started');
    await expect(paginationService.startCalibration()).resolves.toBe('started');
  });
});
