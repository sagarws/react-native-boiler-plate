import { screenOcrService } from '../services/screenOcr.service';

// iOS / no native module: every call must be a safe no-op.
jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: null,
}));

describe('without the native module', () => {
  it('reports unsupported and never throws', async () => {
    expect(screenOcrService.isSupported()).toBe(false);
    await expect(screenOcrService.getStatus()).resolves.toEqual({
      supported: false,
      overlayPermission: false,
      serviceRunning: false,
    });
    await expect(screenOcrService.enable()).resolves.toBe('unsupported');
    await expect(screenOcrService.copy('text')).resolves.toBe(false);
    await expect(screenOcrService.latest()).resolves.toBeNull();
    await expect(screenOcrService.drainPending()).resolves.toEqual([]);
    expect(() => screenOcrService.disable()).not.toThrow();
  });
});
