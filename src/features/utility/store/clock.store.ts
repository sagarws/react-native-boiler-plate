import { storage, StorageKeys } from '@/store/mmkv';
import {
  IDLE_STOPWATCH,
  MAX_LAPS,
  clampDuration,
  idleTimer,
  type StopwatchState,
  type TimerState,
} from '../services/clock';

/**
 * Stopwatch + countdown timer state (MMKV). Only timestamps are stored, so
 * a running stopwatch or timer keeps the right time while the app is in the
 * background or closed. Bad values are dropped on load.
 */

export interface ClockData {
  stopwatch: StopwatchState;
  timer: TimerState;
}

const DEFAULT_TIMER_MS = 5 * 60 * 1000;

type R = Record<string, unknown>;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

function clean(v: unknown): ClockData {
  const r = (v && typeof v === 'object' ? v : {}) as R;
  const sw = (
    r.stopwatch && typeof r.stopwatch === 'object' ? r.stopwatch : {}
  ) as R;
  const tm = (r.timer && typeof r.timer === 'object' ? r.timer : {}) as R;
  const laps = Array.isArray(sw.laps)
    ? sw.laps
        .map(num)
        .filter((x): x is number => x !== null)
        .slice(0, MAX_LAPS)
    : [];
  const duration = clampDuration(num(tm.durationMs) ?? DEFAULT_TIMER_MS);
  const remaining = num(tm.remainingMs);
  return {
    stopwatch: {
      startedAt: num(sw.startedAt),
      elapsedMs: num(sw.elapsedMs) ?? 0,
      laps,
    },
    timer:
      duration > 0
        ? {
            durationMs: duration,
            endsAt: num(tm.endsAt),
            remainingMs: Math.min(duration, remaining ?? duration),
          }
        : idleTimer(DEFAULT_TIMER_MS),
  };
}

function load(): ClockData {
  try {
    return clean(
      JSON.parse(storage.getString(StorageKeys.UtilityClock) ?? 'null'),
    );
  } catch {
    return clean(null);
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: ClockData | null = null;

function read(): ClockData {
  if (!cache) cache = load();
  return cache;
}

function commit(next: ClockData) {
  cache = next;
  storage.set(StorageKeys.UtilityClock, JSON.stringify(next));
  listeners.forEach(l => l());
}

export const clockStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  setStopwatch(stopwatch: StopwatchState) {
    commit({ ...read(), stopwatch });
  },
  resetStopwatch() {
    commit({ ...read(), stopwatch: IDLE_STOPWATCH });
  },
  setTimer(timer: TimerState) {
    commit({ ...read(), timer });
  },
  /** Tests only. */
  resetCacheForTest() {
    cache = null;
  },
};
