import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { logger } from '@/shared/utils';
import {
  EMPTY_KB,
  scanKeyboard,
  type KbHost,
  type KbStatus,
} from '../services/scanKeyboard.service';

/**
 * The phone's Bluetooth keyboard for as long as the screen is mounted: it is
 * registered on mount (reconnecting to the last computer) and removed on
 * unmount, so the computer never sees a keyboard the user isn't using.
 */
export function useScanKeyboard() {
  const [status, setStatus] = useState<KbStatus>(EMPTY_KB);
  const [hosts, setHosts] = useState<KbHost[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refreshHosts = useCallback(() => {
    scanKeyboard.hosts().then(setHosts, error => {
      logger.warn('scan keyboard: hosts', (error as Error)?.message);
      setHosts([]);
    });
  }, []);

  /** Starts the keyboard if nothing blocks it; refreshes status and hosts. */
  const ensureStarted = useCallback(async () => {
    try {
      const s = await scanKeyboard.status();
      // 'permission' / 'bluetooth_off' wait for the user; 'stopped' can start.
      if (s.state === 'stopped') await scanKeyboard.start();
      setStatus(await scanKeyboard.status());
    } catch (error) {
      logger.warn('scan keyboard: start', (error as Error)?.message);
    } finally {
      setLoaded(true);
      refreshHosts();
    }
  }, [refreshHosts]);

  useEffect(() => {
    const off = scanKeyboard.onStatus(s => {
      setStatus(s);
      refreshHosts();
      // Bluetooth was switched off and on again: register once more.
      if (s.state === 'stopped') void ensureStarted();
    });
    void ensureStarted();
    // Back from Bluetooth settings or the permission dialog.
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void ensureStarted();
    });
    return () => {
      off();
      sub.remove();
      scanKeyboard.stop();
    };
  }, [ensureStarted, refreshHosts]);

  const allow = useCallback(async () => {
    const granted = await scanKeyboard.requestPermission();
    if (granted) await ensureStarted();
    return granted;
  }, [ensureStarted]);

  return { status, hosts, loaded, allow, refresh: ensureStarted };
}
