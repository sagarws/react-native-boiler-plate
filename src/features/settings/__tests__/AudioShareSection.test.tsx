import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import {
  captureSettingsStore,
  sanitizeCaptureSettings,
} from '@/features/capture/store/captureSettings.store';
import { buildNativeConfig } from '@/features/capture/services/screenOcr.service';
import {
  audioShareService,
  parseAudioShareStatus,
} from '@/features/capture/services/audioShare.service';
import { storage } from '@/store/mmkv';
import { AudioShareSection } from '../components/AudioShareSection';

jest.mock(
  'react-native/Libraries/PermissionsAndroid/PermissionsAndroid',
  () => ({
    PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    request: jest.fn(() => Promise.resolve('granted')),
  }),
);

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getAudioShareStatus: jest.fn(),
    respondAudioShare: jest.fn(),
    disconnectAudioShare: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const status = (patch: object) =>
  JSON.stringify({
    state: 'waiting',
    address: '192.168.1.23',
    port: 47811,
    receiverName: '',
    fingerprint: '',
    transmitting: false,
    error: '',
    deviceAudio: 'off',
    ...patch,
  });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function render() {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <AudioShareSection expanded onToggle={() => undefined} />,
    );
  });
  mounted.push(r!);
  return r!;
}

function find(
  r: ReactTestRenderer.ReactTestRenderer,
  id: string,
  prop: string,
) {
  return r.root.findAll(n => n.props.testID === id && prop in n.props)[0];
}

const has = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;

async function act(fn: () => void) {
  await ReactTestRenderer.act(async () => {
    fn();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.getAudioShareStatus.mockResolvedValue(status({}));
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  storage.clearAll();
  captureSettingsStore.resetCacheForTest();
});

describe('Share voice to Chrome card', () => {
  it('is off by default and does not poll the phone', async () => {
    const r = await render();
    expect(captureSettingsStore.read().audioShare.enabled).toBe(false);
    expect(mockNative.getAudioShareStatus).not.toHaveBeenCalled();
    expect(has(r, 'audio-share-address')).toBe(false);
  });

  it('turning it on shows the address to enter in Chrome (no code)', async () => {
    const r = await render();
    await act(() =>
      find(r, 'audio-share-enabled', 'onValueChange').props.onValueChange(true),
    );
    expect(captureSettingsStore.read().audioShare.enabled).toBe(true);
    expect(find(r, 'audio-share-address', 'children').props.children).toEqual([
      '192.168.1.23',
      ':',
      47811,
    ]);
  });

  it('asks for approval with the fingerprint, and Allow/Deny reach native', async () => {
    captureSettingsStore.updateAudioShare({ enabled: true });
    mockNative.getAudioShareStatus.mockResolvedValue(
      status({
        state: 'pending',
        receiverName: 'Chrome on Windows',
        fingerprint: '123 456',
      }),
    );
    const r = await render();
    expect(find(r, 'audio-share-request', 'message').props.message).toContain(
      'Allow only if your computer shows 123 456.',
    );
    await act(() => find(r, 'audio-share-allow', 'onPress').props.onPress());
    expect(mockNative.respondAudioShare).toHaveBeenCalledWith(true);
    await act(() => find(r, 'audio-share-deny', 'onPress').props.onPress());
    expect(mockNative.respondAudioShare).toHaveBeenCalledWith(false);
  });

  it('shows streaming state and can disconnect', async () => {
    captureSettingsStore.updateAudioShare({ enabled: true });
    mockNative.getAudioShareStatus.mockResolvedValue(
      status({
        state: 'streaming',
        receiverName: 'Chrome on Windows',
        transmitting: true,
      }),
    );
    const r = await render();
    expect(find(r, 'audio-share-state', 'label').props.label).toBe('Streaming');
    expect(find(r, 'audio-share-activity', 'children').props.children).toBe(
      'Sending audio now',
    );
    await act(() =>
      find(r, 'audio-share-disconnect', 'onPress').props.onPress(),
    );
    expect(mockNative.disconnectAudioShare).toHaveBeenCalled();
  });

  it('explains when the phone is not on Wi-Fi and offers Retry', async () => {
    captureSettingsStore.updateAudioShare({ enabled: true });
    mockNative.getAudioShareStatus.mockResolvedValue(
      status({ error: 'no_wifi' }),
    );
    const r = await render();
    expect(find(r, 'audio-share-error', 'message').props.message).toMatch(
      /Wi-Fi/,
    );
    expect(has(r, 'audio-share-address')).toBe(false);
    expect(has(r, 'audio-share-retry')).toBe(true);
  });
});

describe('all phone audio', () => {
  it('choosing it asks for the capture permission and is saved', async () => {
    captureSettingsStore.updateAudioShare({ enabled: true });
    const request = jest
      .spyOn(audioShareService, 'requestCapturePermission')
      .mockResolvedValue(true);
    const r = await render();
    await act(() =>
      find(r, 'audio-share-source-device', 'onPress').props.onPress(),
    );
    expect(request).toHaveBeenCalled();
    expect(captureSettingsStore.read().audioShare.source).toBe('device');
  });

  it('explains what is missing (floating button off)', async () => {
    captureSettingsStore.updateAudioShare({ enabled: true, source: 'device' });
    mockNative.getAudioShareStatus.mockResolvedValue(
      status({ deviceAudio: 'needs_bubble' }),
    );
    const r = await render();
    expect(find(r, 'audio-share-device', 'message').props.message).toMatch(
      /floating button/,
    );
  });
});

describe('audio share settings and status', () => {
  it('persist the switch and reach native config', () => {
    const settings = sanitizeCaptureSettings({ audioShare: { enabled: true } });
    expect(settings.audioShare).toEqual({ enabled: true, source: 'app' });
    expect(sanitizeCaptureSettings({ audioShare: 'yes' }).audioShare).toEqual({
      enabled: false,
      source: 'app',
    });
    const config = buildNativeConfig(settings, {
      background: '#000',
      icon: '#fff',
      panel: '#000',
      panelText: '#fff',
    });
    expect(config.audioShare).toEqual({ enabled: true, source: 'app' });
  });

  it('parse defensively', () => {
    expect(parseAudioShareStatus('nope').state).toBe('off');
    const s = parseAudioShareStatus(
      status({ state: 'hacked', error: 'weird', transmitting: 'yes' }),
    );
    expect(s.state).toBe('off');
    expect(s.error).toBe('');
    expect(s.transmitting).toBe(false);
  });
});
