import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { alarms } from '@/services/alarms';
import {
  isNotificationPermissionGranted,
  requestNotificationPermission,
} from '@/shared/utils/permissions';
import { alarmEntries } from '../services/reminders';
import { remindersStore } from '../store/reminders.store';
import type { Reminder, ReminderInput } from '../types';

export function useRemindersData(): Reminder[] {
  return useSyncExternalStore(remindersStore.subscribe, remindersStore.read);
}

/** Date.now(), refreshed every 30 s and when the app returns to the foreground. */
export function useNowMs(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 30_000);
    const sub = AppState.addEventListener(
      'change',
      s => s === 'active' && tick(),
    );
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, []);
  return now;
}

/** What the last alarm sync achieved (shown on the dashboard). */
export type AlarmState =
  | { kind: 'unknown' }
  | { kind: 'ok'; exact: boolean }
  | { kind: 'blocked' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

let state: AlarmState = { kind: 'unknown' };
const stateListeners = new Set<() => void>();
const setState = (next: AlarmState) => {
  state = next;
  stateListeners.forEach(l => l());
};

export function useAlarmState(): AlarmState {
  return useSyncExternalStore(
    l => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    },
    () => state,
  );
}

const bodyOf = (t: TFunction) => (r: Reminder) => {
  const kind =
    r.category === 'custom' && r.customLabel
      ? r.customLabel
      : t(`reminders.category_${r.category}`);
  return r.description ? `${kind} · ${r.description}` : kind;
};

/** Hands every enabled reminder to the native alarm engine (replacing the old set). */
export async function syncReminderAlarms(t: TFunction): Promise<void> {
  const entries = alarmEntries(remindersStore.read(), Date.now(), bodyOf(t));
  const r = await alarms.sync('reminder', entries);
  if (r.kind === 'unavailable') return setState({ kind: 'unavailable' });
  if (r.kind === 'failed') return setState({ kind: 'failed' });
  const allowed = entries.length
    ? await isNotificationPermissionGranted()
    : true;
  setState(allowed ? { kind: 'ok', exact: r.exact } : { kind: 'blocked' });
}

const SYNC_DELAY_MS = 400;

/**
 * App-level: keeps the native alarms equal to the stored reminders — after
 * every change (debounced) and whenever the app returns to the foreground
 * (e.g. after the exact-alarm setting changed). Mounted in App.tsx.
 */
export function useReminderAlarmSync(): void {
  const { t } = useTranslation();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void syncReminderAlarms(t);
      }, SYNC_DELAY_MS);
    };
    schedule();
    const off = remindersStore.subscribe(schedule);
    const sub = AppState.addEventListener(
      'change',
      s => s === 'active' && schedule(),
    );
    return () => {
      clearTimeout(timer);
      off();
      sub.remove();
    };
  }, [t]);
}

/** Store mutations for screens; the first reminder asks for notifications. */
export const reminderActions = {
  async create(input: ReminderInput) {
    const r = remindersStore.create(input);
    if (r.ok) await requestNotificationPermission();
    return r;
  },
  update: (id: string, input: ReminderInput) =>
    remindersStore.update(id, input),
  setEnabled: (id: string, enabled: boolean) => {
    if (!enabled) alarms.dismiss(`reminder:${id}`);
    remindersStore.setEnabled(id, enabled);
  },
  remove: (id: string) => {
    alarms.dismiss(`reminder:${id}`);
    remindersStore.remove(id);
  },
  openExactSettings: alarms.openExactAlarmSettings,
};
