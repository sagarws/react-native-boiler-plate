import React from 'react';
import {
  Alert,
  AppState,
  DeviceEventEmitter,
  Linking,
  type AlertButton,
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
import TimerEditScreen from '../screens/TimerEditScreen';
import { TIMER_ALERT } from '../store/clock.store';
import CompassScreen from '../screens/CompassScreen';
import MeasureScreen from '../screens/MeasureScreen';
import ScannerScreen from '../screens/ScannerScreen';
import UtilityHubScreen from '../screens/UtilityHubScreen';
import WaterEjectScreen from '../screens/WaterEjectScreen';

let mockFocused = true;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
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
  },
}));
jest.mock('@/specs/NativeAlarms', () => ({
  __esModule: true,
  default: {
    sync: jest.fn(),
    dismiss: jest.fn(),
    getRinging: jest.fn(),
    getArmed: jest.fn(),
    pickRingtone: jest.fn(),
    ringtoneTitle: jest.fn(),
    previewRingtone: jest.fn(),
    stopPreview: jest.fn(),
    hasVibrator: jest.fn(),
    canScheduleExactAlarms: jest.fn(),
    openExactAlarmSettings: jest.fn(),
    canUseFullScreenIntent: jest.fn(),
    openFullScreenIntentSettings: jest.fn(),
  },
}));
const alarmNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeAlarms',
).default;
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
  alarmNative.sync.mockImplementation(async (_g: string, json: string) =>
    JSON.stringify({ armed: JSON.parse(json).length, exact: true }),
  );
  alarmNative.hasVibrator.mockResolvedValue(true);
  alarmNative.canUseFullScreenIntent.mockResolvedValue(true);
  alarmNative.pickRingtone.mockResolvedValue(
    JSON.stringify({ uri: 'content://media/alarm/7', title: 'Morning' }),
  );
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

describe('Multiple Stopwatch', () => {
  afterEach(() => jest.useRealTimers());

  const ids = () => clockStore.read().stopwatches.map(s => s.id);

  it('runs several stopwatches independently, with laps', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const r = await render(<StopwatchScreen />);
    expect(has(r, 'stopwatch-empty')).toBe(true);
    await press(r, 'stopwatch-add');
    await press(r, 'stopwatch-add');
    await press(r, 'stopwatch-add');
    const [a, b, c] = ids();
    expect(text(r)).toContain('Stopwatch 3');

    await press(r, `stopwatch-start-${a}`);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await press(r, `stopwatch-start-${b}`);
    await press(r, `stopwatch-lap-${a}`);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2000);
    });
    await press(r, `stopwatch-lap-${a}`);
    await press(r, `stopwatch-pause-${b}`);
    await press(r, `stopwatch-lap-${a}`);

    const [sa, sb, sc] = clockStore.read().stopwatches;
    expect(sa.laps).toEqual([1000, 3000, 3000]);
    expect(sa.startedAt).not.toBeNull();
    expect(sb).toMatchObject({ startedAt: null, elapsedMs: 2000 });
    expect(sc).toMatchObject({ startedAt: null, elapsedMs: 0 });
    expect(byId(r, `stopwatch-time-${b}`).props.children).toBe('00:02.00');
    expect(has(r, `lap-${a}-3`)).toBe(true);
    expect(has(r, `stopwatch-reset-${c}`)).toBe(true);

    // Resuming keeps the banked time.
    await press(r, `stopwatch-start-${b}`);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(500);
    });
    await press(r, `stopwatch-pause-${b}`);
    expect(clockStore.read().stopwatches[1].elapsedMs).toBe(2500);
  });

  it('keeps counting after the app was closed, renames and deletes', async () => {
    clockStore.addStopwatch('Run');
    const [id] = ids();
    clockStore.updateStopwatch(id, () => ({
      startedAt: Date.now() - 65_000,
      elapsedMs: 0,
      laps: [],
    }));
    const r = await render(<StopwatchScreen />);
    expect(byId(r, `stopwatch-time-${id}`).props.children).toMatch(/^01:0[56]/);

    await press(r, `stopwatch-rename-${id}`);
    await ReactTestRenderer.act(async () => {
      byId(r, 'stopwatch-rename-field').props.onChangeText('Morning run');
    });
    await press(r, 'stopwatch-rename-save');
    expect(clockStore.read().stopwatches[0].name).toBe('Morning run');

    const alert = jest.spyOn(Alert, 'alert');
    await press(r, `stopwatch-delete-${id}`);
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    await ReactTestRenderer.act(async () => {
      buttons.find(x => x.style === 'destructive')?.onPress?.();
    });
    expect(clockStore.read().stopwatches).toHaveLength(0);
    alert.mockRestore();
  });
});

describe('Multiple Timer', () => {
  afterEach(() => jest.useRealTimers());

  const synced = () => {
    const calls = alarmNative.sync.mock.calls;
    return JSON.parse(calls[calls.length - 1][1]) as {
      key: string;
      at: number;
      alert: { mode: string; ringtone: string };
    }[];
  };

  it('runs three timers at once; one finishing leaves the others running', async () => {
    jest.useFakeTimers({ now: 5_000_000 });
    const r = await render(<TimerScreen />);
    await press(r, 'timer-quick-1');
    await press(r, 'timer-quick-5');
    await press(r, 'timer-quick-10');
    const [t1, t5, t10] = clockStore.read().timers;
    expect(clockStore.read().timers).toHaveLength(3);
    // One alarm per running timer, each at its own end time.
    expect(synced().map(e => [e.key, e.at])).toEqual([
      [`timer:${t1.id}`, 5_060_000],
      [`timer:${t5.id}`, 5_300_000],
      [`timer:${t10.id}`, 5_600_000],
    ]);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1000);
    });
    await press(r, `timer-pause-${t5.id}`);
    expect(synced().map(e => e.key)).toEqual([
      `timer:${t1.id}`,
      `timer:${t10.id}`,
    ]);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(text(r)).toContain("Time's up");
    expect(byId(r, `timer-phase-${t10.id}`).props.label).toBe('Running');
    expect(byId(r, `timer-phase-${t5.id}`).props.label).toBe('Paused');

    // Dismissing the finished one stops only its alarm.
    await press(r, `timer-reset-${t1.id}`);
    expect(alarmNative.dismiss).toHaveBeenCalledWith(`timer:${t1.id}`);
    expect(byId(r, `timer-phase-${t10.id}`).props.label).toBe('Running');

    await press(r, `timer-start-${t5.id}`);
    expect(synced().map(e => e.key)).toContain(`timer:${t5.id}`);
  });

  it('creates a named timer with its own ringtone, and saves presets', async () => {
    jest.useFakeTimers({ now: 6_000_000 });
    const r = await render(<TimerEditScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'timer-name').props.onChangeText('Tea');
      byId(r, 'timer-h').props.onChangeText('0');
      byId(r, 'timer-m').props.onChangeText('3');
      byId(r, 'timer-s').props.onChangeText('30');
    });
    await press(r, 'timer-save-preset');
    expect(clockStore.read().presets[0]).toMatchObject({
      name: 'Tea',
      durationMs: 210_000,
    });
    await press(r, 'timer-alert-ringtone');
    await ReactTestRenderer.act(async () => {
      byId(r, 'timer-alert-mode').props.onChange('sound');
    });
    await press(r, 'timer-save');
    const [tea] = clockStore.read().timers;
    expect(tea).toMatchObject({
      name: 'Tea',
      durationMs: 210_000,
      alert: { mode: 'sound', ringtone: 'content://media/alarm/7' },
    });
    expect(synced()[0]).toMatchObject({
      key: `timer:${tea.id}`,
      at: 6_210_000,
      alert: { mode: 'sound', ringtone: 'content://media/alarm/7' },
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('keeps the remaining time after the app was closed and warns about inexact alarms', async () => {
    alarmNative.sync.mockResolvedValue(
      JSON.stringify({ armed: 1, exact: false }),
    );
    const timer = clockStore.addTimer({
      name: 'Laundry',
      durationMs: 600_000,
      alert: TIMER_ALERT,
    })!;
    clockStore.updateTimer(timer.id, x => ({
      ...x,
      endsAt: Date.now() + 300_000,
    }));
    const r = await render(<TimerScreen />);
    expect(byId(r, `timer-time-${timer.id}`).props.children).toMatch(/^0[45]:/);
    await press(r, `timer-pause-${timer.id}`);
    await press(r, `timer-start-${timer.id}`);
    expect(has(r, 'timer-inexact')).toBe(true);
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
