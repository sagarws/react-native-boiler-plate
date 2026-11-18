/** How a scheduled alarm alerts (mirrors android/.../alarms/AlarmModels.kt). */

export const ALERT_MODES = [
  'both',
  'sound',
  'vibrate',
  'silent',
  'priority',
] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export const VIBRATION_PATTERNS = [
  'default',
  'short',
  'long',
  'heartbeat',
] as const;
export type VibrationPattern = (typeof VIBRATION_PATTERNS)[number];

export const SNOOZE_CHOICES = [0, 5, 10, 15, 30] as const;

export const REPEATS = [
  'never',
  'daily',
  'weekly',
  'monthly',
  'yearly',
] as const;
export type Repeat = (typeof REPEATS)[number];

export interface AlertConfig {
  mode: AlertMode;
  /** Ringtone content URI; '' = the phone's default alarm sound. */
  ringtone: string;
  /** Shown name of the ringtone ('' = default). */
  ringtoneTitle: string;
  /** 0–100, relative to the phone's alarm volume. */
  volume: number;
  vibration: VibrationPattern;
  /** 0 = no snooze. */
  snoozeMinutes: number;
  /** Auto-stop after this many seconds. */
  ringSeconds: number;
}

export const DEFAULT_ALERT: AlertConfig = {
  mode: 'both',
  ringtone: '',
  ringtoneTitle: '',
  volume: 80,
  vibration: 'default',
  snoozeMinutes: 5,
  ringSeconds: 60,
};

/** One alarm handed to the native engine. */
export interface AlarmEntry {
  /** "<group>:<id>". */
  key: string;
  title: string;
  body: string;
  /** Fixed instant (epoch ms) — or 0 for a local wall-clock date + time. */
  at: number;
  date: string;
  time: string;
  repeat: Repeat;
  alert: AlertConfig;
  /** rnboilerplate:// deep link opened from the notification. */
  link: string;
}

export type AlarmGroup = 'reminder' | 'timer';

export type SyncResult =
  | { kind: 'scheduled'; armed: number; exact: boolean }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;

/** Validates a stored alert config, filling defaults. */
export function cleanAlert(v: unknown): AlertConfig {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const num = (x: unknown, min: number, max: number, d: number) =>
    typeof x === 'number' && Number.isFinite(x)
      ? Math.max(min, Math.min(max, Math.round(x)))
      : d;
  const ringtone =
    typeof r.ringtone === 'string' && r.ringtone.startsWith('content://')
      ? r.ringtone.slice(0, 500)
      : '';
  return {
    mode: oneOf(r.mode, ALERT_MODES, DEFAULT_ALERT.mode),
    ringtone,
    ringtoneTitle:
      ringtone && typeof r.ringtoneTitle === 'string'
        ? r.ringtoneTitle.slice(0, 100)
        : '',
    volume: num(r.volume, 0, 100, DEFAULT_ALERT.volume),
    vibration: oneOf(r.vibration, VIBRATION_PATTERNS, DEFAULT_ALERT.vibration),
    snoozeMinutes: num(r.snoozeMinutes, 0, 60, DEFAULT_ALERT.snoozeMinutes),
    ringSeconds: num(r.ringSeconds, 5, 300, DEFAULT_ALERT.ringSeconds),
  };
}
