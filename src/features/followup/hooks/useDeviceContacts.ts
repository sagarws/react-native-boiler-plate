import { useCallback, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { check, PERMISSIONS, request, RESULTS } from 'react-native-permissions';
import { logger } from '@/shared/utils';
import {
  parseDeviceContacts,
  type DeviceContact,
} from '../services/deviceContacts';
import { followUpNative } from '../services/native.service';

export type ContactsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; contacts: DeviceContact[] }
  | { kind: 'denied' }
  | { kind: 'blocked' }
  | { kind: 'error' };

/**
 * The phone's contacts for "fill from contacts". Access is asked only when
 * the user opens the list; the list lives in memory for this screen only.
 * Without permission the system picker (one contact, no permission) remains.
 */
export function useDeviceContacts() {
  const [state, setState] = useState<ContactsState>({ kind: 'idle' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    if (Platform.OS !== 'android') {
      setState({ kind: 'error' });
      return;
    }
    try {
      const permission = PERMISSIONS.ANDROID.READ_CONTACTS;
      let status = await check(permission);
      if (status !== RESULTS.GRANTED && status !== RESULTS.BLOCKED)
        status = await request(permission);
      if (status !== RESULTS.GRANTED) {
        setState({ kind: status === RESULTS.BLOCKED ? 'blocked' : 'denied' });
        return;
      }
    } catch (error) {
      logger.warn('contacts permission failed', (error as Error)?.message);
      setState({ kind: 'error' });
      return;
    }
    const result = await followUpNative.deviceContacts();
    if (!result.ok)
      setState({ kind: result.error === 'blocked' ? 'denied' : 'error' });
    else
      setState({ kind: 'ready', contacts: parseDeviceContacts(result.value) });
  }, []);

  /** One contact via the system picker; null when cancelled or unavailable. */
  const pickWithSystem =
    useCallback(async (): Promise<DeviceContact | null> => {
      const result = await followUpNative.pickContact();
      if (!result.ok || !result.value) return null;
      return parseDeviceContacts(result.value)[0] ?? null;
    }, []);

  const openSettings = useCallback(() => {
    Linking.openSettings().catch(error =>
      logger.warn('settings could not be opened', (error as Error)?.message),
    );
  }, []);

  return { state, load, pickWithSystem, openSettings };
}
