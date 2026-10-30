import React from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import RecorderScreen from '../screens/RecorderScreen';
import RecordingsScreen from '../screens/RecordingsScreen';
import RecordingDetailScreen from '../screens/RecordingDetailScreen';
import { RecordingSettings } from '../components/RecordingSettings';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
  useIsFocused: () => true,
}));
jest.mock('@/specs/NativeRecorder', () => ({
  __esModule: true,
  default: {
    getStatus: jest.fn(),
    getConfig: jest.fn(),
    updateConfig: jest.fn(),
    setBubbleEnabled: jest.fn(),
    openOverlaySettings: jest.fn(),
    resetBubblePosition: jest.fn(),
    runAction: jest.fn(),
    stopRecording: jest.fn(),
    pauseResume: jest.fn(),
    endCapture: jest.fn(),
    listRecordings: jest.fn(),
    renameRecording: jest.fn(),
    deleteRecording: jest.fn(),
    remerge: jest.fn(),
    openRecording: jest.fn(),
    openSegment: jest.fn(),
    shareRecording: jest.fn(),
    editScreenshot: jest.fn(),
    pickDirectory: jest.fn(),
    clearDirectory: jest.fn(),
    getDirectories: jest.fn(),
    testDirectory: jest.fn(),
    getVideoCapabilities: jest.fn(),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeRecorder',
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
    .map(n => n.props.children)
    .flat()
    .join(' ');
const press = async (r: Renderer, id: string) => {
  await ReactTestRenderer.act(async () => {
    byId(r, id).props.onPress();
  });
};
const emit = async (type: string, body: Record<string, unknown>) => {
  await ReactTestRenderer.act(async () => {
    DeviceEventEmitter.emit('RecorderEvent', {
      type,
      body: JSON.stringify(body),
    });
  });
};

const STATUS = {
  supported: true,
  sdk: 34,
  overlayPermission: true,
  micPermission: true,
  notifications: true,
  systemAudioSupported: true,
  bubbleShown: false,
  state: 'idle',
  captureHeld: false,
};

const RECORDINGS = [
  {
    id: 'v1',
    type: 'video',
    name: 'ScreenRecording_2026-10-30_10-30-15_Final.mp4',
    uri: 'content://media/v1',
    createdAt: 2000,
    durationMs: 125_000,
    sizeBytes: 9_000_000,
    width: 720,
    height: 1600,
    fps: 30,
    audio: 'system',
    status: 'completed',
    segmentMinutes: 1,
    keepSegments: true,
    segments: [
      {
        index: 0,
        name: 's1',
        startUs: 0,
        durationUs: 60e6,
        sizeBytes: 1,
        status: 'done',
      },
      {
        index: 1,
        name: 's2',
        startUs: 60e6,
        durationUs: 60e6,
        sizeBytes: 1,
        status: 'done',
      },
      {
        index: 2,
        name: 's3',
        startUs: 120e6,
        durationUs: 5e6,
        sizeBytes: 1,
        status: 'done',
      },
    ],
  },
  {
    id: 'i1',
    type: 'audio',
    name: 'VoiceRecording_2026-10-29_09-00-00.m4a',
    uri: '',
    createdAt: 1000,
    status: 'interrupted',
    error: 'process_killed',
    audio: 'mic',
    segments: [
      {
        index: 0,
        name: 's1',
        startUs: 0,
        durationUs: 300e6,
        sizeBytes: 1,
        status: 'done',
      },
      {
        index: 1,
        name: 's2',
        startUs: 300e6,
        durationUs: 0,
        sizeBytes: 0,
        status: 'failed',
      },
    ],
  },
  {
    id: 's1',
    type: 'screenshot',
    name: 'Screenshot_2026-10-30_11-00-00.png',
    uri: 'content://media/s1',
    createdAt: 3000,
    status: 'completed',
    width: 1080,
    height: 2400,
    audio: 'none',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = undefined;
  native.getStatus.mockResolvedValue(JSON.stringify(STATUS));
  native.getConfig.mockResolvedValue(JSON.stringify({ mode: 'screenshot' }));
  native.updateConfig.mockImplementation(async (patch: string) =>
    JSON.stringify({ mode: 'screenshot', ...JSON.parse(patch) }),
  );
  native.listRecordings.mockResolvedValue(JSON.stringify(RECORDINGS));
  native.getDirectories.mockResolvedValue('{}');
  native.getVideoCapabilities.mockResolvedValue(
    JSON.stringify({
      screenWidth: 1080,
      screenHeight: 2400,
      encoder: 'enc',
      presets: { medium: { width: 720, height: 1600, fps: 30, bitrate: 4e6 } },
    }),
  );
  native.setBubbleEnabled.mockResolvedValue('shown');
  native.deleteRecording.mockResolvedValue(true);
  native.openRecording.mockResolvedValue(true);
});

afterEach(() => {
  mounted.splice(0).forEach(r => ReactTestRenderer.act(() => r.unmount()));
});

describe('RecorderScreen', () => {
  it('turns the recording button on', async () => {
    const r = await render(<RecorderScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-enable-button').props.onChange(true);
    });
    expect(native.setBubbleEnabled).toHaveBeenCalledWith(true);
    expect(has(r, 'rec-overlay-notice')).toBe(false);
  });

  it('explains the overlay permission when it is missing', async () => {
    native.setBubbleEnabled.mockResolvedValue('overlay_permission');
    const r = await render(<RecorderScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-enable-button').props.onChange(true);
    });
    expect(has(r, 'rec-overlay-notice')).toBe(true);
  });

  it('saves the tap mode and starts it from the app', async () => {
    const r = await render(<RecorderScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-mode').props.onChange('screen_voice');
    });
    const patches = native.updateConfig.mock.calls.map(c => JSON.parse(c[0]));
    expect(patches).toContainEqual({ mode: 'screen_voice' });
    await press(r, 'rec-start');
    expect(native.runAction).toHaveBeenCalledWith('screen_voice');
  });

  it('follows the live session from native events', async () => {
    const r = await render(<RecorderScreen />);
    await emit('state', {
      state: 'recording',
      elapsedMs: 65_000,
      segment: 2,
      content: 'Video + system audio',
    });
    expect(text(r)).toContain('1:05');
    expect(text(r)).toContain('Part 2');
    expect(byId(r, 'rec-start').props.disabled).toBe(true);
    await press(r, 'rec-stop');
    expect(native.stopRecording).toHaveBeenCalled();
    await emit('state', { state: 'merging', mergeProgress: 0.5 });
    expect(text(r)).toContain('50%');
  });

  it('asks before hiding the button during a recording', async () => {
    native.getStatus.mockResolvedValue(
      JSON.stringify({ ...STATUS, bubbleShown: true, state: 'recording' }),
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render(<RecorderScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-enable-button').props.onChange(false);
    });
    expect(alert).toHaveBeenCalled();
    expect(native.setBubbleEnabled).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('points to interrupted sessions', async () => {
    const r = await render(<RecorderScreen />);
    expect(has(r, 'rec-interrupted')).toBe(true);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-interrupted').props.action.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('UtilityRecordings', {
      filter: 'interrupted',
    });
  });

  it('shows a native error once', async () => {
    const r = await render(<RecorderScreen />);
    await emit('error', { code: 'storage_low' });
    expect(text(r)).toContain('Storage is almost full');
  });
});

describe('RecordingsScreen', () => {
  it('lists newest first and filters by tab', async () => {
    const r = await render(<RecordingsScreen />);
    const items = () =>
      r.root
        .findAll(
          n =>
            typeof n.props.testID === 'string' &&
            n.props.testID.startsWith('rec-item-') &&
            typeof n.type !== 'string',
        )
        .map(n => n.props.testID)
        .filter((id, i, all) => all.indexOf(id) === i);
    expect(items()).toEqual(['rec-item-s1', 'rec-item-v1', 'rec-item-i1']);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-filter').props.onChange('videos');
    });
    expect(items()).toEqual(['rec-item-v1']);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-filter').props.onChange('interrupted');
    });
    expect(items()).toEqual(['rec-item-i1']);
  });

  it('refreshes when the library changes', async () => {
    await render(<RecordingsScreen />);
    native.listRecordings.mockClear();
    await emit('library_changed', {});
    expect(native.listRecordings).toHaveBeenCalled();
  });
});

describe('RecordingDetailScreen', () => {
  it('shows the session parts and re-merges', async () => {
    mockParams = { recordingId: 'v1' };
    const r = await render(<RecordingDetailScreen />);
    expect(has(r, 'rec-part-2')).toBe(true);
    expect(text(r)).toContain('2:05');
    await press(r, 'rec-play');
    expect(native.openRecording).toHaveBeenCalledWith('v1');
    await press(r, 'rec-merge');
    expect(native.remerge).toHaveBeenCalledWith('v1');
  });

  it('offers merging an interrupted session but not playing it', async () => {
    mockParams = { recordingId: 'i1' };
    const r = await render(<RecordingDetailScreen />);
    expect(has(r, 'rec-play')).toBe(false);
    expect(has(r, 'rec-merge')).toBe(true);
    expect(text(r)).toContain('closed by Android');
  });

  it('edits a screenshot and deletes after confirmation', async () => {
    mockParams = { recordingId: 's1' };
    native.editScreenshot.mockResolvedValue(true);
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons) => {
        const destructive = buttons?.find(b => b.style === 'destructive');
        void destructive?.onPress?.();
      });
    const r = await render(<RecordingDetailScreen />);
    await press(r, 'rec-edit');
    expect(native.editScreenshot).toHaveBeenCalledWith('s1');
    await press(r, 'rec-delete');
    expect(native.deleteRecording).toHaveBeenCalledWith('s1');
    expect(mockGoBack).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('renames through the native module', async () => {
    mockParams = { recordingId: 'v1' };
    native.renameRecording.mockResolvedValue(
      JSON.stringify({ ...RECORDINGS[0], name: 'Demo.mp4' }),
    );
    const r = await render(<RecordingDetailScreen />);
    await press(r, 'rec-rename');
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-rename-input').props.onChangeText('Demo');
    });
    await press(r, 'rec-rename-save');
    expect(native.renameRecording).toHaveBeenCalledWith('v1', 'Demo');
  });
});

describe('RecordingSettings', () => {
  it('validates a custom segment length', async () => {
    const r = await render(<RecordingSettings />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-section-segments').props.onToggle();
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-custom-minutes').props.onChangeText('500');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-custom-minutes').props.onSubmitEditing();
    });
    expect(text(r)).toContain('Enter whole minutes from 1 to 120.');
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-custom-minutes').props.onChangeText('7');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-custom-minutes').props.onSubmitEditing();
    });
    const patches = native.updateConfig.mock.calls.map(c => JSON.parse(c[0]));
    expect(patches).toContainEqual({ segmentMinutes: 7 });
  });

  it('shows the quality actually applied on this phone', async () => {
    const r = await render(<RecordingSettings />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'rec-section-video').props.onToggle();
    });
    expect(text(r)).toContain('720×1600, 30 fps');
  });

  it('syncs the overlay theme with the app theme', async () => {
    await render(<RecordingSettings />);
    const patches = native.updateConfig.mock.calls.map(c => JSON.parse(c[0]));
    expect(patches.some(p => typeof p.dark === 'boolean')).toBe(true);
  });
});
