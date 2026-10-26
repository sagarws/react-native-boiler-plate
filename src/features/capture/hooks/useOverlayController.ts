import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { screenOcrService } from '../services/screenOcr.service';
import type {
  EnableOutcome,
  OverlayNotice,
  OverlayStatus,
} from '../capture.types';

export interface UseOverlayController {
  status: OverlayStatus;
  /** First status read has not come back yet. */
  loading: boolean;
  /** An enable/disable request is in flight. */
  busy: boolean;
  notice: OverlayNotice;
  enable: () => Promise<EnableOutcome>;
  disable: () => void;
  openOverlaySettings: () => void;
  dismissNotice: () => void;
  refresh: () => Promise<void>;
}

const INITIAL: OverlayStatus = {
  supported: screenOcrService.isSupported(),
  overlayPermission: false,
  serviceRunning: false,
};

/** Maps an enable outcome to what the user should be told, if anything. */
export function noticeForOutcome(outcome: EnableOutcome): OverlayNotice {
  switch (outcome) {
    case 'overlay_permission':
      return 'overlay_permission';
    case 'cancelled':
      return 'cancelled';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/**
 * State and actions for the floating button. Re-reads the native status when
 * the app returns to the foreground (the user may have changed a permission
 * in system settings) and whenever the service starts or stops.
 */
export function useOverlayController(): UseOverlayController {
  const [status, setStatus] = useState<OverlayStatus>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<OverlayNotice>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await screenOcrService.getStatus();
    if (!mounted.current) return;
    // Permission revoked while running: the bubble window is gone, so stop the
    // capture session too rather than hold it with nothing to tap.
    if (next.serviceRunning && !next.overlayPermission) {
      screenOcrService.disable();
      setNotice('revoked');
      setStatus({ ...next, serviceRunning: false });
    } else {
      setStatus(next);
      if (next.overlayPermission) {
        setNotice(current =>
          current === 'overlay_permission' ? null : current,
        );
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    const unsubscribe = screenOcrService.onStatus(() => {
      void refresh();
    });
    return () => {
      mounted.current = false;
      appState.remove();
      unsubscribe();
    };
  }, [refresh]);

  const enable = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const outcome = await screenOcrService.enable();
    if (mounted.current) {
      setNotice(noticeForOutcome(outcome));
      setBusy(false);
    }
    await refresh();
    return outcome;
  }, [refresh]);

  const disable = useCallback(() => {
    screenOcrService.disable();
    setNotice(null);
    // Optimistic: the service's stop event confirms it a moment later.
    setStatus(current => ({ ...current, serviceRunning: false }));
  }, []);

  const openOverlaySettings = useCallback(
    () => screenOcrService.openOverlaySettings(),
    [],
  );
  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    status,
    loading,
    busy,
    notice,
    enable,
    disable,
    openOverlaySettings,
    dismissNotice,
    refresh,
  };
}
