import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { alarms, type AlarmEntry, type AlertConfig } from '@/services/alarms';
import { requestNotificationPermission } from '@/shared/utils/permissions';
import {
  extendTimer,
  formatClock,
  lapRows,
  lapStopwatch,
  pauseStopwatch,
  pauseTimer,
  resetTimer,
  startStopwatch,
  startTimer,
  stopwatchElapsed,
  timerPhase,
  timerRemaining,
  type LapRow,
  type TimerPhase,
} from '../services/clock';
import {
  clockStore,
  type ClockData,
  type NamedStopwatch,
  type NamedTimer,
  type TimerPreset,
} from '../store/clock.store';
import { useScreenActive } from './useUtility';

export function useClockData(): ClockData {
  return useSyncExternalStore(clockStore.subscribe, clockStore.read);
}

/**
 * Date.now(), refreshed every [ms] only while [running] and the screen is
 * active — nothing ticks in the background (the times are timestamp based).
 */
export function useNow(running: boolean, ms: number): number {
  const active = useScreenActive();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running || !active) return undefined;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [running, active, ms]);
  return now;
}

// ── Stopwatches ──

export interface StopwatchView extends NamedStopwatch {
  elapsed: number;
  running: boolean;
  lapList: LapRow[];
}

export function useStopwatches() {
  const { stopwatches } = useClockData();
  const anyRunning = stopwatches.some(s => s.startedAt !== null);
  const now = useNow(anyRunning, 47);
  const items: StopwatchView[] = stopwatches.map(s => ({
    ...s,
    elapsed: stopwatchElapsed(s, now),
    running: s.startedAt !== null,
    lapList: lapRows(s.laps),
  }));
  return {
    items,
    add: (name: string) => clockStore.addStopwatch(name),
    start: (id: string) =>
      clockStore.updateStopwatch(id, s => startStopwatch(s, Date.now())),
    pause: (id: string) =>
      clockStore.updateStopwatch(id, s => pauseStopwatch(s, Date.now())),
    lap: (id: string) =>
      clockStore.updateStopwatch(id, s => lapStopwatch(s, Date.now())),
    reset: (id: string) =>
      clockStore.updateStopwatch(id, () => ({
        startedAt: null,
        elapsedMs: 0,
        laps: [],
      })),
    rename: clockStore.renameStopwatch,
    remove: clockStore.deleteStopwatch,
  };
}

// ── Timers ──

export const BUILTIN_PRESET_MINUTES = [1, 5, 10, 15, 30, 45, 60] as const;

export const timerKey = (id: string) => `timer:${id}`;

/** The alarms for every running timer (pure, exported for tests). */
export function timerAlarmEntries(
  timers: readonly NamedTimer[],
  now: number,
  t: TFunction,
): AlarmEntry[] {
  return timers
    .filter(x => x.endsAt !== null && x.endsAt > now)
    .map(x => ({
      key: timerKey(x.id),
      title: t('utility.timerDoneTitleNamed', { name: x.name }),
      body: t('utility.timerDoneBody', {
        time: formatClock(x.durationMs, false),
      }),
      at: x.endsAt!,
      date: '',
      time: '',
      repeat: 'never',
      alert: x.alert,
      link: 'rnboilerplate://utility/timers',
    }));
}

export type TimerAlarmState = 'exact' | 'inexact' | 'no_notifications' | null;

/** Re-arms the timer group of the alarm engine from the stored timers. */
async function syncTimers(t: TFunction): Promise<TimerAlarmState> {
  const entries = timerAlarmEntries(clockStore.read().timers, Date.now(), t);
  if (!entries.length) {
    await alarms.sync('timer', []);
    return null;
  }
  const allowed = await requestNotificationPermission();
  const r = await alarms.sync('timer', entries);
  if (!allowed) return 'no_notifications';
  return r.kind === 'scheduled' ? (r.exact ? 'exact' : 'inexact') : null;
}

export interface TimerView extends NamedTimer {
  remaining: number;
  phase: TimerPhase;
  /** 0–1 of the duration left. */
  progress: number;
}

export function useTimers() {
  const { t } = useTranslation();
  const { timers, presets } = useClockData();
  const now = useNow(
    timers.some(x => x.endsAt !== null),
    250,
  );
  const [alarmState, setAlarmState] = useState<TimerAlarmState>(null);
  const sync = useCallback(() => syncTimers(t).then(setAlarmState), [t]);

  const items: TimerView[] = timers.map(x => {
    const remaining = timerRemaining(x, now);
    return {
      ...x,
      remaining,
      phase: timerPhase(x, now),
      progress: x.durationMs ? remaining / x.durationMs : 0,
    };
  });

  const change = async (
    id: string,
    fn: Parameters<typeof clockStore.updateTimer>[1],
  ) => {
    clockStore.updateTimer(id, fn);
    await sync();
  };
  /** Stops the alert if this timer is ringing. */
  const quiet = (id: string) => alarms.dismiss(timerKey(id));

  return {
    items,
    presets,
    alarmState,
    add: async (input: {
      name: string;
      durationMs: number;
      alert: AlertConfig;
    }) => {
      const timer = clockStore.addTimer(input);
      return timer;
    },
    edit: async (
      id: string,
      input: { name: string; durationMs: number; alert: AlertConfig },
    ) => {
      quiet(id);
      clockStore.editTimer(id, input);
      await sync();
    },
    start: (id: string) => change(id, x => startTimer(x, Date.now())),
    pause: (id: string) => change(id, x => pauseTimer(x, Date.now())),
    reset: (id: string) => {
      quiet(id);
      return change(id, x => resetTimer(x));
    },
    addMinute: (id: string) => {
      quiet(id);
      return change(id, x => extendTimer(x, 60_000, Date.now()));
    },
    remove: async (id: string) => {
      quiet(id);
      clockStore.deleteTimer(id);
      await sync();
    },
    savePreset: (name: string, durationMs: number): TimerPreset | null =>
      clockStore.addPreset(name, durationMs),
    deletePreset: clockStore.deletePreset,
    openExactSettings: alarms.openExactAlarmSettings,
  };
}
