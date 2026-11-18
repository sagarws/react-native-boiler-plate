/**
 * Stopwatch and countdown-timer logic. Pure and timestamp-based: state
 * stores *when* something started, never a ticking counter, so the time is
 * right after the app was in the background or closed. `now` is passed in
 * (ms since epoch) so everything is testable.
 */

export interface StopwatchState {
  /** When the current run started; null while stopped. */
  startedAt: number | null;
  /** Time banked from earlier runs. */
  elapsedMs: number;
  /** Total elapsed time at each lap, oldest first. */
  laps: number[];
}

export interface TimerState {
  /** The length the user set. */
  durationMs: number;
  /** When it reaches zero; null while paused or idle. */
  endsAt: number | null;
  /** Time left while paused (equals durationMs when idle). */
  remainingMs: number;
}

export const MAX_LAPS = 99;
/** 99:59:59 — the largest timer the picker allows. */
export const MAX_TIMER_MS = (99 * 3600 + 59 * 60 + 59) * 1000;

export const IDLE_STOPWATCH: StopwatchState = {
  startedAt: null,
  elapsedMs: 0,
  laps: [],
};

export const stopwatchElapsed = (s: StopwatchState, now: number): number =>
  s.elapsedMs + (s.startedAt === null ? 0 : Math.max(0, now - s.startedAt));

export const startStopwatch = (
  s: StopwatchState,
  now: number,
): StopwatchState => (s.startedAt === null ? { ...s, startedAt: now } : s);

export const pauseStopwatch = (
  s: StopwatchState,
  now: number,
): StopwatchState =>
  s.startedAt === null
    ? s
    : { ...s, startedAt: null, elapsedMs: stopwatchElapsed(s, now) };

/** Records a lap (only while running, up to MAX_LAPS). */
export function lapStopwatch(s: StopwatchState, now: number): StopwatchState {
  if (s.startedAt === null || s.laps.length >= MAX_LAPS) return s;
  return { ...s, laps: [...s.laps, stopwatchElapsed(s, now)] };
}

export interface LapRow {
  /** 1-based. */
  index: number;
  /** This lap's own length. */
  splitMs: number;
  /** Total time when the lap was taken. */
  totalMs: number;
  fastest: boolean;
  slowest: boolean;
}

/** Laps newest first, with their split and fastest / slowest flags (2+ laps). */
export function lapRows(laps: readonly number[]): LapRow[] {
  const splits = laps.map((t, i) => t - (i ? laps[i - 1] : 0));
  const min = Math.min(...splits);
  const max = Math.max(...splits);
  const marks = splits.length > 1 && min !== max;
  return splits
    .map((split, i) => ({
      index: i + 1,
      splitMs: split,
      totalMs: laps[i],
      fastest: marks && split === min,
      slowest: marks && split === max,
    }))
    .reverse();
}

export const idleTimer = (durationMs: number): TimerState => {
  const d = clampDuration(durationMs);
  return { durationMs: d, endsAt: null, remainingMs: d };
};

export const clampDuration = (ms: number): number =>
  Number.isFinite(ms) ? Math.max(0, Math.min(MAX_TIMER_MS, Math.round(ms))) : 0;

export const timerRemaining = (t: TimerState, now: number): number =>
  t.endsAt === null ? t.remainingMs : Math.max(0, t.endsAt - now);

export type TimerPhase = 'idle' | 'running' | 'paused' | 'finished';

export function timerPhase(t: TimerState, now: number): TimerPhase {
  if (t.endsAt !== null) return t.endsAt <= now ? 'finished' : 'running';
  if (t.remainingMs <= 0) return 'finished';
  return t.remainingMs < t.durationMs ? 'paused' : 'idle';
}

/** Starts or resumes; nothing to start when no time is left. */
export function startTimer(t: TimerState, now: number): TimerState {
  if (t.endsAt !== null || t.remainingMs <= 0) return t;
  return { ...t, endsAt: now + t.remainingMs };
}

export const pauseTimer = (t: TimerState, now: number): TimerState =>
  t.endsAt === null
    ? t
    : { ...t, endsAt: null, remainingMs: timerRemaining(t, now) };

/** Back to the full duration, stopped. */
export const resetTimer = (t: TimerState): TimerState =>
  idleTimer(t.durationMs);

/** Adds time to a running, paused or finished timer (e.g. "+1 min"). */
export function extendTimer(
  t: TimerState,
  addMs: number,
  now: number,
): TimerState {
  const left = timerRemaining(t, now);
  const next = clampDuration(left + addMs);
  if (t.endsAt !== null && t.endsAt > now) return { ...t, endsAt: now + next };
  // Finished or paused: resume from the new amount.
  return {
    ...t,
    endsAt: t.endsAt !== null ? now + next : null,
    remainingMs: next,
  };
}

export const toMs = (h: number, m: number, s: number): number =>
  clampDuration(((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000);

export function splitMs(ms: number): { h: number; m: number; s: number } {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "01:02.34" (stopwatch, with hundredths), "1:02:03.45" past an hour;
 * "05:00" / "1:05:00" for the timer (whole seconds, rounded up so it never
 * shows 00:00 while time is left).
 */
export function formatClock(ms: number, hundredths: boolean): string {
  const safe = Math.max(0, ms);
  const totalSec = hundredths
    ? Math.floor(safe / 1000)
    : Math.ceil(safe / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return hundredths ? `${base}.${pad(Math.floor((safe % 1000) / 10))}` : base;
}
