import React from 'react';
import { Alert, AppState, DeviceEventEmitter, Linking } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { check, request } from 'react-native-permissions';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { utilityStore } from '../store/utility.store';
import CompassScreen from '../screens/CompassScreen';
import MeasureScreen from '../screens/MeasureScreen';
import ScannerScreen from '../screens/ScannerScreen';
import UtilityHubScreen from '../screens/UtilityHubScreen';
import WaterEjectScreen from '../screens/WaterEjectScreen';

let mockFocused = true;
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
  useIsFocused: () => mockFocused,
}));
jest.mock('@/specs/NativeUtility', () => ({
  __esModule: true,
  default: {
    getCompassSupport: jest.fn(),
    startCompass: jest.fn(),
    stopCompass: jest.fn(),
    hasVibrator: jest.fn(),
    startTone: jest.fn(),
    stopTone: jest.fn(),
    scanBarcode: jest.fn(),
    getDocumentScannerSupport: jest.fn(),
    getArSupport: jest.fn(),
    measure: jest.fn(),
  },
}));
jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: { copyToClipboard: jest.fn().mockResolvedValue(true) },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeUtility',
).default;

type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];
async function render(node: React.ReactElement) {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r!);
  return r!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const text = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.filter(c => typeof c === 'string').join(''))
    .join('\n');
async function press(r: Renderer, id: string) {
  await ReactTestRenderer.act(async () => {
    await byId(r, id).props.onPress();
  });
}

beforeEach(() => {
  storage.clearAll();
  utilityStore.resetCacheForTest();
  mockFocused = true;
  jest.clearAllMocks();
  native.getCompassSupport.mockResolvedValue('rotation_vector');
  native.hasVibrator.mockResolvedValue(true);
  native.startTone.mockResolvedValue('playing');
  native.getDocumentScannerSupport.mockResolvedValue('available');
  native.getArSupport.mockResolvedValue('supported');
  (check as jest.Mock).mockResolvedValue('granted');
  (request as jest.Mock).mockResolvedValue('granted');
});
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('Utility hub', () => {
  it('lists every tool with its requirement and opens it', async () => {
    native.getArSupport.mockResolvedValue('unsupported');
    const r = await render(<UtilityHubScreen />);
    for (const key of ['scanner', 'documents', 'compass', 'measure', 'water'])
      expect(has(r, `tool-${key}`)).toBe(true);
    expect(text(r)).toContain('This phone doesn’t support ARCore');
    await press(r, 'tool-compass');
    expect(mockNavigate).toHaveBeenCalledWith('UtilityCompass');
    // Opening the hub starts nothing.
    expect(native.startCompass).not.toHaveBeenCalled();
    expect(native.startTone).not.toHaveBeenCalled();
  });
});

describe('Compass', () => {
  it('runs the sensor only while the screen is active', async () => {
    const r = await render(<CompassScreen />);
    expect(native.startCompass).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('UtilityCompass', { heading: 92.4, accuracy: 1 });
    });
    expect(text(r)).toContain('92°');
    expect(text(r)).toContain('E');
    expect(has(r, 'compass-calibrate')).toBe(true);
    mockFocused = false;
    await ReactTestRenderer.act(async () => r.update(<CompassScreen />));
    expect(native.stopCompass).toHaveBeenCalled();
  });

  it('explains when there is no compass sensor', async () => {
    native.getCompassSupport.mockResolvedValue('none');
    const r = await render(<CompassScreen />);
    expect(has(r, 'compass-unavailable')).toBe(true);
    expect(native.startCompass).not.toHaveBeenCalled();
  });
});

describe('Scanner', () => {
  it('handles camera permission denial without opening the camera', async () => {
    (check as jest.Mock).mockResolvedValue('denied');
    (request as jest.Mock).mockResolvedValue('blocked');
    const r = await render(<ScannerScreen />);
    await press(r, 'scanner-start');
    expect(native.scanBarcode).not.toHaveBeenCalled();
    expect(text(r)).toContain('Camera access is off');
  });

  it('saves a scan and opens links only after confirmation', async () => {
    native.scanBarcode.mockResolvedValue(
      JSON.stringify({ value: 'http://example.com', format: 'QR_CODE' }),
    );
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<ScannerScreen />);
    await press(r, 'scanner-start');
    expect(utilityStore.read().scans[0]).toMatchObject({
      kind: 'url',
      value: 'http://example.com',
    });
    await press(r, 'scan-action-open');
    expect(open).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][1]).toContain('isn’t secure');
    alert.mock.calls[0][2]!.find(b => b.text === 'Open link')!.onPress!();
    expect(open).toHaveBeenCalledWith('http://example.com');
  });

  it('never offers to open an unsafe scheme', async () => {
    native.scanBarcode.mockResolvedValue(
      // eslint-disable-next-line no-script-url -- checks that this scheme is never opened
      JSON.stringify({ value: 'javascript:alert(1)', format: 'QR_CODE' }),
    );
    const r = await render(<ScannerScreen />);
    await press(r, 'scanner-start');
    expect(has(r, 'scan-action-open')).toBe(false);
    expect(has(r, 'scan-action-copy')).toBe(true);
  });
});

describe('Speaker Water Eject', () => {
  it('plays only on Start and stops on Stop', async () => {
    const r = await render(<WaterEjectScreen />);
    expect(native.startTone).not.toHaveBeenCalled();
    await press(r, 'water-start');
    expect(native.startTone).toHaveBeenCalledWith('low', 30000, false);
    expect(has(r, 'water-stop')).toBe(true);
    await press(r, 'water-stop');
    expect(native.stopTone).toHaveBeenCalled();
    expect(text(r)).toContain('Stopped.');
  });

  it('stops when the app goes to the background and reports interruptions', async () => {
    let appListener: (s: string) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, l) => {
      appListener = l as (s: string) => void;
      return { remove: jest.fn() } as never;
    });
    const r = await render(<WaterEjectScreen />);
    await press(r, 'water-start');
    await ReactTestRenderer.act(async () => appListener('background'));
    expect(native.stopTone).toHaveBeenCalled();

    native.stopTone.mockClear();
    await ReactTestRenderer.act(async () => appListener('active'));
    await press(r, 'water-start');
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('UtilityToneEnded', { reason: 'interrupted' });
    });
    expect(text(r)).toContain('another app needed the audio');
  });

  it('says so when another app holds the audio', async () => {
    native.startTone.mockResolvedValue('focus_denied');
    const r = await render(<WaterEjectScreen />);
    await press(r, 'water-start');
    expect(has(r, 'water-stop')).toBe(false);
    expect(has(r, 'water-ended')).toBe(true);
  });
});

describe('AR Measure', () => {
  it('shows a clear fallback on unsupported phones', async () => {
    native.getArSupport.mockResolvedValue('unsupported');
    const r = await render(<MeasureScreen />);
    expect(has(r, 'measure-unsupported')).toBe(true);
    expect(has(r, 'measure-start')).toBe(false);
  });

  it('saves a valid result and reports an AR failure', async () => {
    native.measure.mockResolvedValueOnce(
      JSON.stringify({ mode: 'length', meters: 1.5, source: 'plane' }),
    );
    const r = await render(<MeasureScreen />);
    await press(r, 'measure-start');
    expect(text(r)).toMatch(/150[.,]0 cm/);
    await press(r, 'measure-save');
    expect(utilityStore.read().measurements[0]).toMatchObject({ meters: 1.5 });

    native.measure.mockRejectedValueOnce(
      Object.assign(new Error('x'), { code: 'ar_failed' }),
    );
    await press(r, 'measure-start');
    expect(has(r, 'measure-problem')).toBe(true);
  });
});
