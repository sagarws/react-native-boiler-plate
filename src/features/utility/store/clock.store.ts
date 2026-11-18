import { cleanAlert, DEFAULT_ALERT, type AlertConfig } from '@/services/alarms';
import { createLocalId as createId } from '@/shared/utils';
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
 * Multiple stopwatches and timers + saved timer presets (MMKV). Only
 * timestamps are stored, so running ones keep the right time while the app
 * is in the background or closed. Bad records are dropped on load; data
 * from the earlier single stopwatch / timer is carried over.
 */

export interface NamedStopwatch extends StopwatchState {
  id: string;
  name: string;
  createdAt: number;
}

export interface NamedTimer extends TimerState {
  id: string;
  name: string;
  alert: AlertConfig;
  createdAt: number;
}

export interface TimerPreset {
  id: string;
  name: string;
  durationMs: number;
}

export interface ClockData {
  stopwatches: NamedStopwatch[];
  timers: NamedTimer[];
  presets: TimerPreset[];
}

export const MAX_STOPWATCHES = 20;
export const MAX_TIMERS = 20;
export const MAX_PRESETS = 20;
const MAX_NAME = 40;

/** Timers ring for 30 s by default (reminders: 60 s). */
export const TIMER_ALERT: AlertConfig = {
  ...DEFAULT_ALERT,
  snoozeMinutes: 0,
  ringSeconds: 30,
};

type R = Record<string, unknown>;
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const name = (v: unknown, d: string) =>
  (typeof v === 'string' ? v.trim().slice(0, MAX_NAME) : '') || d;
const obj = (v: unknown): R => (v && typeof v === 'object' ? (v as R) : {});

function cleanStopwatch(r: R, i: number): NamedStopwatch | null {
  if (typeof r.id !== 'string') return null;
  const laps = Array.isArray(r.laps)
    ? r.laps
        .map(num)
        .filter((x): x is number => x !== null)
        .slice(0, MAX_LAPS)
    : [];
  return {
    id: r.id,
    name: name(r.name, `#${i + 1}`),
    startedAt: num(r.startedAt),
    elapsedMs: num(r.elapsedMs) ?? 0,
    laps,
    createdAt: num(r.createdAt) ?? 0,
  };
}

function cleanTimerState(r: R): TimerState | null {
  const duration = clampDuration(num(r.durationMs) ?? 0);
  if (duration <= 0) return null;
  return {
    durationMs: duration,
    endsAt: num(r.endsAt),
    remainingMs: Math.min(duration, num(r.remainingMs) ?? duration),
  };
}

function cleanTimer(r: R, i: number): NamedTimer | null {
  const t = cleanTimerState(r);
  if (typeof r.id !== 'string' || !t) return null;
  return {
    ...t,
    id: r.id,
    name: name(r.name, `#${i + 1}`),
    alert: r.alert ? cleanAlert(r.alert) : TIMER_ALERT,
    createdAt: num(r.createdAt) ?? 0,
  };
}

function cleanPreset(r: R): TimerPreset | null {
  const d = clampDuration(num(r.durationMs) ?? 0);
  if (typeof r.id !== 'string' || d <= 0) return null;
  return { id: r.id, name: name(r.name, ''), durationMs: d };
}

const list = <T>(
  v: unknown,
  clean: (r: R, i: number) => T | null,
  max: number,
) =>
  Array.isArray(v)
    ? v
        .map((x, i) => clean(obj(x), i))
        .filter((x): x is T => x !== null)
        .slice(0, max)
    : [];

/** Exported for tests. */
export function cleanClock(v: unknown): ClockData {
  const r = obj(v);
  // Earlier versions kept one stopwatch and one timer.
  if (!Array.isArray(r.stopwatches) && (r.stopwatch || r.timer)) {
    const sw = obj(r.stopwatch);
    const tm = cleanTimerState(obj(r.timer));
    const stopwatches: NamedStopwatch[] =
      num(sw.startedAt) !== null || (num(sw.elapsedMs) ?? 0) > 0
        ? [cleanStopwatch({ ...sw, id: createId(), name: '' }, 0)!]
        : [];
    const timers: NamedTimer[] = tm
      ? [
          {
            ...tm,
            id: createId(),
            name: '#1',
            alert: TIMER_ALERT,
            createdAt: 0,
          },
        ]
      : [];
    return { stopwatches, timers, presets: [] };
  }
  return {
    stopwatches: list(r.stopwatches, cleanStopwatch, MAX_STOPWATCHES),
    timers: list(r.timers, cleanTimer, MAX_TIMERS),
    presets: list(r.presets, cleanPreset, MAX_PRESETS),
  };
}

function load(): ClockData {
  try {
    return cleanClock(
      JSON.parse(storage.getString(StorageKeys.UtilityClock) ?? 'null'),
    );
  } catch {
    return cleanClock(null);
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

const replace = <T extends { id: string }>(
  items: T[],
  id: string,
  fn: (x: T) => T,
) => items.map(x => (x.id === id ? fn(x) : x));

export const clockStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // ── Stopwatches ──
  addStopwatch(label: string): NamedStopwatch | null {
    const d = read();
    if (d.stopwatches.length >= MAX_STOPWATCHES) return null;
    const sw: NamedStopwatch = {
      ...IDLE_STOPWATCH,
      id: createId(),
      name: name(label, `#${d.stopwatches.length + 1}`),
      createdAt: Date.now(),
    };
    commit({ ...d, stopwatches: [...d.stopwatches, sw] });
    return sw;
  },
  updateStopwatch(id: string, fn: (s: StopwatchState) => StopwatchState) {
    const d = read();
    commit({
      ...d,
      stopwatches: replace(d.stopwatches, id, s => ({ ...s, ...fn(s) })),
    });
  },
  renameStopwatch(id: string, label: string) {
    const d = read();
    commit({
      ...d,
      stopwatches: replace(d.stopwatches, id, s => ({
        ...s,
        name: name(label, s.name),
      })),
    });
  },
  deleteStopwatch(id: string) {
    const d = read();
    commit({ ...d, stopwatches: d.stopwatches.filter(s => s.id !== id) });
  },

  // ── Timers ──
  addTimer(input: {
    name: string;
    durationMs: number;
    alert: AlertConfig;
  }): NamedTimer | null {
    const d = read();
    const ms = clampDuration(input.durationMs);
    if (d.timers.length >= MAX_TIMERS || ms <= 0) return null;
    const t: NamedTimer = {
      ...idleTimer(ms),
      id: createId(),
      name: name(input.name, `#${d.timers.length + 1}`),
      alert: cleanAlert(input.alert),
      createdAt: Date.now(),
    };
    commit({ ...d, timers: [...d.timers, t] });
    return t;
  },
  /** Name / duration / alert. A new duration resets the timer. */
  editTimer(
    id: string,
    input: { name: string; durationMs: number; alert: AlertConfig },
  ) {
    const d = read();
    const ms = clampDuration(input.durationMs);
    if (ms <= 0) return;
    commit({
      ...d,
      timers: replace(d.timers, id, t => ({
        ...t,
        ...(ms !== t.durationMs ? idleTimer(ms) : {}),
        name: name(input.name, t.name),
        alert: cleanAlert(input.alert),
      })),
    });
  },
  updateTimer(id: string, fn: (t: TimerState) => TimerState) {
    const d = read();
    commit({ ...d, timers: replace(d.timers, id, t => ({ ...t, ...fn(t) })) });
  },
  deleteTimer(id: string) {
    const d = read();
    commit({ ...d, timers: d.timers.filter(t => t.id !== id) });
  },

  // ── Presets ──
  addPreset(label: string, durationMs: number): TimerPreset | null {
    const d = read();
    const ms = clampDuration(durationMs);
    if (ms <= 0 || d.presets.length >= MAX_PRESETS) return null;
    if (d.presets.some(p => p.durationMs === ms && p.name === label.trim()))
      return null;
    const p: TimerPreset = {
      id: createId(),
      name: name(label, ''),
      durationMs: ms,
    };
    commit({ ...d, presets: [...d.presets, p] });
    return p;
  },
  deletePreset(id: string) {
    const d = read();
    commit({ ...d, presets: d.presets.filter(p => p.id !== id) });
  },

  /** Tests only. */
  resetCacheForTest() {
    cache = null;
  },
};
