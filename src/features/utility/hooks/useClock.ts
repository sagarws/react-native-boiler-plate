import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Vibration } from 'react-native';
import { useTranslation } from 'react-i18next';
import { requestNotificationPermission } from '@/shared/utils/permissions';
import {
  extendTimer,
  formatClock,
  idleTimer,
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
  type TimerState,
} from '../services/clock';
import { utilityNative } from '../services/native.service';
import { clockStore, type ClockData } from '../store/clock.store';
import { useScreenActive } from './useUtility';

export function useClockData(): ClockData {
  return useSyncExternalStore(clockStore.subscribe, clockStore.read);
}

/** Date.now(), refreshed every [ms] while [running] and the screen is active. */
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

export interface Stopwatch {
  elapsedMs: number;
  running: boolean;
  laps: LapRow[];
  start: () => void;
  pause: () => void;
  lap: () => void;
  reset: () => void;
}

export function useStopwatch(): Stopwatch {
  const { stopwatch } = useClockData();
  const running = stopwatch.startedAt !== null;
  const now = useNow(running, 47);
  return {
    elapsedMs: stopwatchElapsed(stopwatch, now),
    running,
    laps: lapRows(stopwatch.laps),
    start: () =>
      clockStore.setStopwatch(
        startStopwatch(clockStore.read().stopwatch, Date.now()),
      ),
    pause: () =>
      clockStore.setStopwatch(
        pauseStopwatch(clockStore.read().stopwatch, Date.now()),
      ),
    lap: () =>
      clockStore.setStopwatch(
        lapStopwatch(clockStore.read().stopwatch, Date.now()),
      ),
    reset: () => clockStore.resetStopwatch(),
  };
}

export type AlarmMode =
  | 'exact'
  | 'inexact'
  | 'unavailable'
  | 'no_notifications';

export interface CountdownTimer {
  state: TimerState;
  remainingMs: number;
  phase: TimerPhase;
  /** How the running timer will alert; null until started. */
  alarm: AlarmMode | null;
  setDuration: (ms: number) => void;
  start: () => Promise<void>;
  pause: () => void;
  reset: () => void;
  addMinute: () => Promise<void>;
  openExactSettings: () => void;
}

/**
 * The countdown timer. Starting arms an Android alarm, so "time's up" is
 * shown as a notification even when the app is closed; pause / reset
 * cancel it. In the app, the end also vibrates the phone.
 */
export function useCountdownTimer(): CountdownTimer {
  const { t } = useTranslation();
  const { timer } = useClockData();
  const now = useNow(timer.endsAt !== null, 250);
  const phase = timerPhase(timer, now);
  const [alarm, setAlarm] = useState<AlarmMode | null>(null);
  const buzzedFor = useRef<number | null>(null);

  const arm = useCallback(
    async (next: TimerState) => {
      if (next.endsAt === null) return;
      const allowed = await requestNotificationPermission();
      const mode = await utilityNative.scheduleTimerAlarm(
        next.endsAt,
        t('utility.timerDoneTitle'),
        t('utility.timerDoneBody', {
          time: formatClock(next.durationMs, false),
        }),
      );
      setAlarm(allowed ? mode : 'no_notifications');
    },
    [t],
  );

  // Ring in the app when it ends while the screen is open.
  useEffect(() => {
    if (phase !== 'finished' || timer.endsAt === null) return;
    if (buzzedFor.current === timer.endsAt) return;
    buzzedFor.current = timer.endsAt;
    Vibration.vibrate([0, 500, 300, 500, 300, 500]);
  }, [phase, timer.endsAt]);

  return {
    state: timer,
    remainingMs: timerRemaining(timer, now),
    phase,
    alarm,
    setDuration: ms => {
      if (timer.endsAt !== null) return;
      clockStore.setTimer(idleTimer(ms));
    },
    start: async () => {
      const next = startTimer(clockStore.read().timer, Date.now());
      clockStore.setTimer(next);
      await arm(next);
    },
    pause: () => {
      utilityNative.cancelTimerAlarm();
      clockStore.setTimer(pauseTimer(clockStore.read().timer, Date.now()));
    },
    reset: () => {
      utilityNative.cancelTimerAlarm();
      Vibration.cancel();
      setAlarm(null);
      clockStore.setTimer(resetTimer(clockStore.read().timer));
    },
    addMinute: async () => {
      const next = extendTimer(clockStore.read().timer, 60_000, Date.now());
      utilityNative.cancelTimerAlarm();
      clockStore.setTimer(next);
      await arm(next);
    },
    openExactSettings: utilityNative.openExactAlarmSettings,
  };
}
