import { Platform } from 'react-native';
import {
  checkNotifications,
  requestNotifications,
} from 'react-native-permissions';
import { logger } from './logger';

/**
 * Runtime permissions asked once at launch. Add a request here only for a
 * permission the app actually exercises; anything used by a single screen is
 * better asked on that screen, where the user can see why.
 */

/** Guards against a re-mount or a fast-refresh asking a second time. */
let startupRequested = false;

/**
 * Notification access. Android 13+ only; earlier versions grant it at
 * install. Best-effort: a refusal is logged, never thrown. Resolves whether
 * notifications are allowed afterwards.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  try {
    const { status } = await checkNotifications();
    if (status === 'granted') return true;
    if (status === 'denied') {
      const result = await requestNotifications(['alert']);
      return result.status === 'granted';
    }
    return false;
  } catch (err) {
    logger.warn('notification permission request failed (ignored)', err);
    return false;
  }
}

/** Whether notifications are currently allowed (always true below Android 13). */
export async function isNotificationPermissionGranted(): Promise<boolean> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return true;
  try {
    const { status } = await checkNotifications();
    return status === 'granted';
  } catch (err) {
    logger.warn('notification permission check failed (ignored)', err);
    return false;
  }
}

/**
 * Asks for everything the app needs at startup. Never throws: a declined
 * permission is handled by the feature that needs it.
 */
export async function requestStartupPermissions(): Promise<void> {
  if (startupRequested) return;
  startupRequested = true;
  await requestNotificationPermission();
}

/** Test seam: lets a suite exercise the first-run path more than once. */
export function resetStartupPermissionsForTest(): void {
  startupRequested = false;
}
