import { Platform } from 'react-native';
import { checkNotifications, requestNotifications } from 'react-native-permissions';
import {
  requestStartupPermissions,
  resetStartupPermissionsForTest,
} from '../permissions';

const mockCheck = checkNotifications as jest.Mock;
const mockRequest = requestNotifications as jest.Mock;

describe('requestStartupPermissions', () => {
  const originalVersion = Platform.Version;

  beforeEach(() => {
    resetStartupPermissionsForTest();
    mockCheck.mockReset().mockResolvedValue({ status: 'denied' });
    mockRequest.mockReset().mockResolvedValue({ status: 'granted' });
    Object.defineProperty(Platform, 'Version', { value: 34, configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
  });

  it('asks for notifications on Android 13+ when not yet granted', async () => {
    await requestStartupPermissions();
    expect(mockRequest).toHaveBeenCalledWith(['alert']);
  });

  it('asks only once per launch', async () => {
    await requestStartupPermissions();
    await requestStartupPermissions();
    expect(mockCheck).toHaveBeenCalledTimes(1);
  });

  it('skips the prompt below Android 13', async () => {
    Object.defineProperty(Platform, 'Version', { value: 32, configurable: true });
    await requestStartupPermissions();
    expect(mockCheck).not.toHaveBeenCalled();
  });

  it('never throws when the native call fails', async () => {
    mockCheck.mockRejectedValue(new Error('boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(requestStartupPermissions()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
