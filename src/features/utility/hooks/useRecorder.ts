import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { logger, requestNotificationPermission } from '@/shared/utils';
import {
  recorderNative,
  type BubbleOutcome,
} from '../services/recorder.service';
import {
  DEFAULT_RECORDER_CONFIG,
  isCapturing,
  parseStatus,
  UNSUPPORTED_STATUS,
} from '../services/recordings';
import type {
  Recording,
  RecorderConfig,
  RecorderStatus,
} from '../recorder.types';

/** Library refreshes after these events; state events refresh the status. */
const LIBRARY_EVENTS = new Set([
  'library_changed',
  'recording_started',
  'segment_completed',
  'merge_started',
  'merge_completed',
]);

export interface UseRecorderStatus {
  status: RecorderStatus;
  loading: boolean;
  /** Live elapsed time while recording (ticks locally; no bridge traffic). */
  elapsedMs: number;
  /** Last native error code (e.g. storage_low), until dismissed. */
  lastError: string | null;
  dismissError: () => void;
  refresh: () => Promise<void>;
}

/**
 * Recorder state from the native service: read on mount and when the app
 * returns to the foreground (permissions may have changed), then kept
 * current by `state` events. The elapsed counter ticks locally from the last
 * event, so nothing is sent per second across the bridge.
 */
export function useRecorderStatus(): UseRecorderStatus {
  const [status, setStatus] = useState<RecorderStatus>(UNSUPPORTED_STATUS);
  const [loading, setLoading] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const stampedAt = useRef(Date.now());
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await recorderNative.status();
    if (!mounted.current) return;
    stampedAt.current = Date.now();
    setStatus(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const app = AppState.addEventListener('change', s => {
      if (s === 'active') void refresh();
    });
    const off = recorderNative.onEvent(event => {
      if (event.type === 'state') {
        stampedAt.current = Date.now();
        setStatus(prev => parseStatus(event.body, prev));
      } else if (event.type === 'error') {
        const code = event.body.code;
        if (typeof code === 'string') setLastError(code);
      } else if (event.type === 'merge_progress') {
        const p = event.body.progress;
        if (typeof p === 'number')
          setStatus(prev => ({ ...prev, mergeProgress: p }));
      }
    });
    return () => {
      mounted.current = false;
      app.remove();
      off();
    };
  }, [refresh]);

  const ticking = status.state === 'recording';
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const elapsedMs = ticking
    ? status.elapsedMs + Math.max(0, now - stampedAt.current)
    : status.elapsedMs;

  return {
    status,
    loading,
    elapsedMs: isCapturing(status.state) ? elapsedMs : 0,
    lastError,
    dismissError: () => setLastError(null),
    refresh,
  };
}

export interface UseRecorderConfig {
  config: RecorderConfig;
  loading: boolean;
  /** Persists natively; the screen updates at once and settles on the saved value. */
  update: (patch: Partial<RecorderConfig>) => Promise<void>;
  error: boolean;
}

export function useRecorderConfig(): UseRecorderConfig {
  const [config, setConfig] = useState<RecorderConfig>(DEFAULT_RECORDER_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    recorderNative
      .config()
      .then(setConfig, e => {
        logger.warn('recorder config read failed', (e as Error)?.message);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    // The floating menu changes the mode natively.
    return recorderNative.onEvent(e => {
      if (e.type === 'config_changed') load();
    });
  }, [load]);

  const update = useCallback(async (patch: Partial<RecorderConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
    try {
      setConfig(await recorderNative.updateConfig(patch));
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  return { config, loading, update, error };
}

export interface UseRecordings {
  recordings: Recording[];
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
}

/** The library, re-read whenever the native side reports a change. */
export function useRecordings(): UseRecordings {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const list = await recorderNative.recordings();
      if (!mounted.current) return;
      setRecordings(list);
      setError(false);
    } catch (e) {
      logger.warn('recordings read failed', (e as Error)?.message);
      if (mounted.current) setError(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const off = recorderNative.onEvent(e => {
      if (
        LIBRARY_EVENTS.has(e.type) ||
        (e.type === 'state' &&
          ['completed', 'failed', 'interrupted', 'idle'].includes(
            String(e.body.state),
          ))
      ) {
        void refresh();
      }
    });
    const app = AppState.addEventListener('change', s => {
      if (s === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      off();
      app.remove();
    };
  }, [refresh]);

  return { recordings, loading, error, refresh };
}

export type EnableResult = BubbleOutcome | 'error';

/**
 * Turns the recording button on/off. Asks Android 13+ for the notification
 * permission first (the recording notification carries Stop); recording
 * still works if it's refused.
 */
export async function setRecorderBubble(
  enabled: boolean,
): Promise<EnableResult> {
  try {
    if (enabled) await requestNotificationPermission();
    return await recorderNative.setBubbleEnabled(enabled);
  } catch (e) {
    logger.error('recorder button toggle failed', (e as Error)?.message);
    return 'error';
  }
}
