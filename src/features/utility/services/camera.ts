import { Linking, Platform } from 'react-native';
import { check, PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import { logger } from '@/shared/utils';

export type CameraAccess = 'granted' | 'denied' | 'blocked' | 'unavailable';

/**
 * Camera access for the scanner and AR Measure, asked only when the user
 * starts one of them (the screen explains why first). "blocked" means
 * Android won't ask again — the user has to allow it in Settings.
 */
export async function ensureCamera(): Promise<CameraAccess> {
  if (Platform.OS !== 'android') return 'unavailable';
  const permission = PERMISSIONS.ANDROID.CAMERA;
  try {
    const current = await check(permission);
    if (current === RESULTS.GRANTED) return 'granted';
    if (current === RESULTS.BLOCKED) return 'blocked';
    const next = await request(permission);
    return next === RESULTS.GRANTED
      ? 'granted'
      : next === RESULTS.BLOCKED
      ? 'blocked'
      : 'denied';
  } catch (error) {
    logger.warn('camera permission request failed', (error as Error)?.message);
    return 'unavailable';
  }
}

/** Opens this app's page in Android Settings (to allow a blocked permission). */
export function openAppSettings(): void {
  Linking.openSettings().catch(error =>
    logger.warn('app settings could not be opened', (error as Error)?.message),
  );
}
