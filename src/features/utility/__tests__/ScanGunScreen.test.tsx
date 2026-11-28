import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import NativeScanKeyboard from '@/specs/NativeScanKeyboard';
import { utilityStore } from '../store/utility.store';
import ScanGunScreen from '../screens/ScanGunScreen';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn(), canGoBack: () => true }),
}));
jest.mock('../services/camera', () => ({
  ensureCamera: jest.fn(async () => 'granted'),
  openAppSettings: jest.fn(),
}));
jest.mock('@/specs/NativeScanKeyboard', () => ({
  __esModule: true,
  default: {
    getStatus: jest.fn(),
    start: jest.fn(async () => 'ready'),
    stop: jest.fn(),
    getHosts: jest.fn(async () => '[]'),
    connect: jest.fn(async () => true),
    disconnect: jest.fn(),
    makeDiscoverable: jest.fn(),
    openBluetoothSettings: jest.fn(),
    typeText: jest.fn(async () => 0),
    startScanGun: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
}));

const M = NativeScanKeyboard as unknown as Record<string, jest.Mock>;
type Renderer = ReactTestRenderer.ReactTestRenderer;

async function render() {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<ScanGunScreen />);
  });
  return r!;
}

const byId = (r: Renderer, id: string) =>
  r.root.find(n => n.props.testID === id && n.props.onPress !== undefined);

describe('Scanner gun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    utilityStore.clearScans();
  });

  it('types codes only once a computer is connected, and keeps them in history', async () => {
    M.getStatus.mockResolvedValue(
      JSON.stringify({
        state: 'connected',
        host: { name: 'Office PC', address: 'AA' },
      }),
    );
    M.startScanGun.mockResolvedValue(
      JSON.stringify([{ value: 'ABC-123', format: 'CODE_128', typed: true }]),
    );
    const r = await render();
    await ReactTestRenderer.act(async () =>
      byId(r, 'gun-start').props.onPress(),
    );

    const options = JSON.parse(M.startScanGun.mock.calls[0][0]);
    expect(options).toMatchObject({ suffix: '\n', beep: true, vibrate: true });
    expect(utilityStore.read().scans[0]?.value).toBe('ABC-123');
    expect(
      r.root.findAll(n => n.props.testID === 'gun-session').length,
    ).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => r.unmount());
    expect(M.stop).toHaveBeenCalled();
  });

  it('starts the keyboard and asks to connect when no computer is connected', async () => {
    M.getStatus
      .mockResolvedValueOnce(JSON.stringify({ state: 'stopped' }))
      .mockResolvedValue(JSON.stringify({ state: 'ready' }));
    M.getHosts.mockResolvedValue(
      JSON.stringify([{ name: 'Office PC', address: 'AA', computer: true }]),
    );
    const r = await render();
    expect(M.start).toHaveBeenCalledTimes(1);
    expect(byId(r, 'gun-start').props.disabled).toBe(true);
    await ReactTestRenderer.act(async () =>
      byId(r, 'gun-host-0').props.onPress(),
    );
    expect(M.connect).toHaveBeenCalledWith('AA');
    await ReactTestRenderer.act(async () => r.unmount());
  });
});
