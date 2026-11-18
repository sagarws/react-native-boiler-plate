import React from 'react';
import {
  Alert,
  AppState,
  DeviceEventEmitter,
  Linking,
  Vibration,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { check, request } from 'react-native-permissions';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { utilityStore } from '../store/utility.store';
import { clockStore } from '../store/clock.store';
import ConverterScreen from '../screens/ConverterScreen';
import LevelScreen from '../screens/LevelScreen';
import StopwatchScreen from '../screens/StopwatchScreen';
import TimerScreen from '../screens/TimerScreen';
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
    sightAngles: jest.fn(),
    getTiltSupport: jest.fn(),
    startTilt: jest.fn(),
    stopTilt: jest.fn(),
    scheduleTimerAlarm: jest.fn(),
    cancelTimerAlarm: jest.fn(),
    canScheduleExactAlarms: jest.fn(),
    openExactAlarmSettings: jest.fn(),
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
  clockStore.resetCacheForTest();
  mockFocused = true;
  jest.clearAllMocks();
  native.getCompassSupport.mockResolvedValue('rotation_vector');
  native.hasVibrator.mockResolvedValue(true);
  native.startTone.mockResolvedValue('playing');
  native.getDocumentScannerSupport.mockResolvedValue('available');
  native.getArSupport.mockResolvedValue('supported');
  native.getTiltSupport.mockResolvedValue('gravity');
  native.scheduleTimerAlarm.mockResolvedValue('exact');
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
    for (const key of [
      'scanner',
      'documents',
      'compass',
      'measure',
      'water',
      'stopwatch',
      'timer',
      'level',
      'converter',
    ])
      expect(has(r, `tool-${key}`)).toBe(true);
    // Without ARCore, measuring still works with angles.
    expect(text(r)).toContain('No ARCore here — angle measuring works');
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

describe('Angle measure', () => {
  const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);
  const atanDeg = (v: number) => (Math.atan(v) * 180) / Math.PI;

  it('is offered on phones without ARCore', async () => {
    native.getArSupport.mockResolvedValue('unsupported');
    const r = await render(<MeasureScreen />);
    await press(r, 'measure-use-angle');
    expect(has(r, 'trig-start')).toBe(true);
  });

  it('asks for the known length before opening the camera', async () => {
    const r = await render(<MeasureScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'measure-method').props.onChange('angle');
    });
    await press(r, 'trig-start');
    expect(native.sightAngles).not.toHaveBeenCalled();
    expect(text(r)).toContain('Enter the known length first');
  });

  it('measures a height from the distance and saves it', async () => {
    // 10 m away; base 1.5 m below the eye, top 4.5 m above → 6 m.
    native.sightAngles.mockResolvedValueOnce(
      JSON.stringify([
        { elevation: atanDeg(-0.15), azimuth: null },
        { elevation: atanDeg(0.45), azimuth: null },
      ]),
    );
    const r = await render(<MeasureScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'measure-method').props.onChange('angle');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'trig-known').props.onChangeText('1000'); // cm
    });
    await press(r, 'trig-start');
    const labels = JSON.parse(native.sightAngles.mock.calls[0][0]);
    expect(labels.steps).toHaveLength(2);
    expect(labels.steps[0]).toContain('Step 1 of 2');
    expect(text(r)).toMatch(/600[.,]0 cm/);
    expect(has(r, 'trig-uncertainty')).toBe(true);
    // The known distance is remembered for next time.
    expect(utilityStore.read().prefs.sightDistance).toBe(10);
    await press(r, 'trig-save');
    expect(utilityStore.read().measurements[0]).toMatchObject({
      mode: 'height',
      source: 'angle',
    });
    expect(utilityStore.read().measurements[0].meters).toBeCloseTo(6);
  });

  it('measures a floor distance from the phone height', async () => {
    native.sightAngles.mockResolvedValueOnce(
      JSON.stringify([{ elevation: -atanDeg(1.5 / 3), azimuth: 12 }]),
    );
    const r = await render(<MeasureScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'measure-method').props.onChange('angle');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'trig-method').props.onChange('distanceFromDeviceHeight');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'trig-known').props.onChangeText('150');
    });
    await press(r, 'trig-start');
    expect(text(r)).toMatch(/300[.,]0 cm/);
    expect(tan(45)).toBeCloseTo(1);
  });

  it('explains a top aimed below the base', async () => {
    native.sightAngles.mockResolvedValueOnce(
      JSON.stringify([
        { elevation: 10, azimuth: null },
        { elevation: 5, azimuth: null },
      ]),
    );
    const r = await render(<MeasureScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'measure-method').props.onChange('angle');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'trig-known').props.onChangeText('500');
    });
    await press(r, 'trig-start');
    expect(text(r)).toContain('The top was aimed below the base');
    expect(has(r, 'trig-result')).toBe(false);
  });
});

describe('Stopwatch', () => {
  afterEach(() => jest.useRealTimers());

  it('starts, laps, pauses and resets from stored timestamps', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const r = await render(<StopwatchScreen />);
    await press(r, 'stopwatch-start');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1500);
    });
    await press(r, 'stopwatch-lap');
    expect(has(r, 'lap-1')).toBe(true);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await press(r, 'stopwatch-pause');
    expect(text(r)).toContain('00:03.50');
    expect(clockStore.read().stopwatch).toMatchObject({
      startedAt: null,
      elapsedMs: 3500,
      laps: [1500],
    });
    await press(r, 'stopwatch-reset');
    expect(text(r)).toContain('00:00.00');
    expect(has(r, 'lap-1')).toBe(false);
  });
});

describe('Timer', () => {
  afterEach(() => jest.useRealTimers());

  it('arms the alarm on start and cancels it on pause and reset', async () => {
    jest.useFakeTimers({ now: 2_000_000 });
    const r = await render(<TimerScreen />);
    await press(r, 'timer-preset-1');
    await press(r, 'timer-start');
    expect(native.scheduleTimerAlarm).toHaveBeenCalledWith(
      2_060_000,
      "Time's up",
      'Your 01:00 timer has finished.',
    );
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(text(r)).toContain('00:40');
    await press(r, 'timer-pause');
    expect(native.cancelTimerAlarm).toHaveBeenCalled();
    expect(text(r)).toContain('Paused');
    await press(r, 'timer-reset');
    expect(text(r)).toContain('01:00');
  });

  it('rings in the app when it ends, and warns about inexact alarms', async () => {
    jest.useFakeTimers({ now: 3_000_000 });
    native.scheduleTimerAlarm.mockResolvedValue('inexact');
    const vibrate = jest
      .spyOn(Vibration, 'vibrate')
      .mockImplementation(() => {});
    const r = await render(<TimerScreen />);
    await press(r, 'timer-preset-1');
    await press(r, 'timer-start');
    expect(has(r, 'timer-inexact')).toBe(true);
    // Its button opens Android's exact-alarm setting.
    await ReactTestRenderer.act(async () => {
      r.root
        .findAll(
          n =>
            typeof n.props.onPress === 'function' &&
            n.props.accessibilityLabel === 'Allow exact alarms',
        )[0]
        ?.props.onPress();
    });
    expect(native.openExactAlarmSettings).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(61_000);
    });
    expect(text(r)).toContain("Time's up");
    expect(vibrate).toHaveBeenCalled();
    await press(r, 'timer-add');
    expect(text(r)).toContain('Running');
    vibrate.mockRestore();
  });

  it('keeps the remaining time after the app was closed', async () => {
    clockStore.setTimer({
      durationMs: 600_000,
      endsAt: Date.now() + 300_000,
      remainingMs: 600_000,
    });
    const r = await render(<TimerScreen />);
    expect(text(r)).toMatch(/0[45]:[0-5]\d/);
    expect(text(r)).toContain('Running');
  });
});

describe('Bubble level', () => {
  it('reads the tilt only while open, and calibrates', async () => {
    const r = await render(<LevelScreen />);
    expect(native.startTilt).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('UtilityTilt', { x: 0.0349, y: 0, z: 0.9994 });
    });
    expect(has(r, 'level-flat')).toBe(true);
    expect(text(r)).toContain('+2.0°');
    await press(r, 'level-calibrate');
    expect(utilityStore.read().prefs.levelCalibration.x).toBeCloseTo(2, 0);
    expect(text(r)).toContain('Level');
    await press(r, 'level-calibrate-reset');
    expect(utilityStore.read().prefs.levelCalibration).toEqual({
      x: 0,
      y: 0,
      edge: 0,
    });
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('UtilityTilt', { x: 0, y: 1, z: 0 });
    });
    expect(has(r, 'level-edge')).toBe(true);
    mockFocused = false;
    await ReactTestRenderer.act(async () => {
      r.update(<LevelScreen />);
    });
    expect(native.stopTilt).toHaveBeenCalled();
  });

  it('explains when there is no tilt sensor', async () => {
    native.getTiltSupport.mockResolvedValue('none');
    const r = await render(<LevelScreen />);
    expect(has(r, 'level-unsupported')).toBe(true);
    expect(native.startTilt).not.toHaveBeenCalled();
  });
});

describe('Unit converter', () => {
  it('converts to every unit and switches the source unit', async () => {
    const r = await render(<ConverterScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'convert-value').props.onChangeText('2');
    });
    expect(byId(r, 'convert-out-cm').props.accessibilityLabel).toBe(
      '200 Centimetres (cm)',
    );
    await press(r, 'convert-cat-temperature');
    await ReactTestRenderer.act(async () => {
      byId(r, 'convert-value').props.onChangeText('100');
    });
    expect(byId(r, 'convert-out-F').props.accessibilityLabel).toBe(
      '212 Fahrenheit (°F)',
    );
    await press(r, 'convert-out-F');
    expect(byId(r, 'convert-value').props.value).toBe('212');
    await ReactTestRenderer.act(async () => {
      byId(r, 'convert-value').props.onChangeText('abc');
    });
    expect(text(r)).toContain('Enter a number');
  });
});
