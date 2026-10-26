import React from 'react';
import { AppState } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  noticeForOutcome,
  useOverlayController,
  type UseOverlayController,
} from '../hooks/useOverlayController';

// Built inside the factory: jest.mock is hoisted above the imports, so a
// module-scope mock object would not exist yet when the service loads.
jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getStatus: jest.fn(),
    startOverlay: jest.fn(),
    stopOverlay: jest.fn(),
    openOverlaySettings: jest.fn(),
  },
}));

const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

let latest: UseOverlayController | null = null;
function Probe() {
  latest = useOverlayController();
  return null;
}

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function mount() {
  await ReactTestRenderer.act(async () => {
    mounted.push(ReactTestRenderer.create(<Probe />));
  });
  if (!latest) throw new Error('hook did not render');
  return () => latest as UseOverlayController;
}

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
  jest.clearAllMocks();
  latest = null;
});

describe('noticeForOutcome', () => {
  it('maps each outcome to what the user is told', () => {
    expect(noticeForOutcome('started')).toBeNull();
    expect(noticeForOutcome('unsupported')).toBeNull();
    expect(noticeForOutcome('cancelled')).toBe('cancelled');
    expect(noticeForOutcome('overlay_permission')).toBe('overlay_permission');
    expect(noticeForOutcome('error')).toBe('error');
  });
});

describe('useOverlayController', () => {
  it('enables the floating button and reflects the running state', async () => {
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: true,
      serviceRunning: false,
    });
    const hook = await mount();
    expect(hook().status.serviceRunning).toBe(false);

    mockNative.startOverlay.mockResolvedValue(true);
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: true,
      serviceRunning: true,
    });
    await ReactTestRenderer.act(async () => {
      await hook().enable();
    });

    expect(hook().status.serviceRunning).toBe(true);
    expect(hook().notice).toBeNull();
  });

  it('disables the floating button', async () => {
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: true,
      serviceRunning: true,
    });
    const hook = await mount();
    await ReactTestRenderer.act(() => hook().disable());
    expect(mockNative.stopOverlay).toHaveBeenCalled();
    expect(hook().status.serviceRunning).toBe(false);
  });

  it('explains a denied overlay permission', async () => {
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: false,
      serviceRunning: false,
    });
    const hook = await mount();
    mockNative.startOverlay.mockRejectedValue(
      Object.assign(new Error('no'), { code: 'overlay_permission' }),
    );
    await ReactTestRenderer.act(async () => {
      await hook().enable();
    });
    expect(hook().notice).toBe('overlay_permission');
  });

  it('explains declined screen-capture consent', async () => {
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: true,
      serviceRunning: false,
    });
    const hook = await mount();
    mockNative.startOverlay.mockResolvedValue(false);
    await ReactTestRenderer.act(async () => {
      await hook().enable();
    });
    expect(hook().notice).toBe('cancelled');
  });

  it('stops the service when the overlay permission is revoked while running', async () => {
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: false,
      serviceRunning: true,
    });
    const hook = await mount();
    expect(mockNative.stopOverlay).toHaveBeenCalled();
    expect(hook().notice).toBe('revoked');
    expect(hook().status.serviceRunning).toBe(false);
  });

  it('re-reads the status when the app returns to the foreground', async () => {
    const listeners: ((state: string) => void)[] = [];
    const spy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_type, handler) => {
        listeners.push(handler as (state: string) => void);
        return { remove: jest.fn() };
      });
    mockNative.getStatus.mockResolvedValue({
      overlayPermission: false,
      serviceRunning: false,
    });
    const hook = await mount();

    mockNative.getStatus.mockResolvedValue({
      overlayPermission: true,
      serviceRunning: false,
    });
    await ReactTestRenderer.act(async () => {
      listeners.forEach(l => l('active'));
    });

    expect(hook().status.overlayPermission).toBe(true);
    spy.mockRestore();
  });
});
