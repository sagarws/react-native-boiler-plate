import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isNotificationPermissionGranted } from '@/shared/utils';
import { followUpNative } from '../services/native.service';
import { buildReminders, type ReminderTexts } from '../services/reminders';
import { followUpStore } from '../store/followup.store';
import type { FollowUpData } from '../types';

/** What the last sync achieved — shown in Follow Up settings. */
export type ReminderState =
  | { kind: 'off' }
  | { kind: 'scheduled'; count: number }
  | { kind: 'blocked' }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

let state: ReminderState = { kind: 'off' };
const listeners = new Set<() => void>();
const setState = (next: ReminderState) => {
  state = next;
  listeners.forEach(l => l());
};

export function useReminderState(): ReminderState {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const SYNC_DELAY_MS = 500;

const wantsReminders = (d: FollowUpData) =>
  d.settings.remindersEnabled || d.settings.birthdayReminders;

/**
 * Keeps Android's scheduled reminders equal to what the data asks for:
 * after every change (debounced) and on each return to the foreground. The
 * state only says "scheduled" once Android confirmed it.
 */
export function useReminderSync(): void {
  const { t } = useTranslation();

  useEffect(() => {
    const typeLabel = (type: string) => t(`followUp.type_${type}`);
    const texts: ReminderTexts = {
      due: (c, a) => ({
        title: t('followUp.reminderDueTitle', { name: c.name }),
        body: a.purpose || typeLabel(a.type),
      }),
      overdue: (c, a) => ({
        title: t('followUp.reminderOverdueTitle', { name: c.name }),
        body: a.purpose || typeLabel(a.type),
      }),
      birthday: c => ({
        title: t('followUp.reminderBirthdayTitle', { name: c.name }),
        body: t('followUp.reminderBirthdayBody'),
      }),
    };

    let lastWanted: boolean | null = null;
    const sync = async () => {
      const data = followUpStore.read();
      const wanted = wantsReminders(data);
      // Nothing was ever scheduled and nothing is wanted: no native call.
      if (!wanted && lastWanted === false) return;
      lastWanted = wanted;
      if (wanted && !(await isNotificationPermissionGranted())) {
        // Clear anything left over; it couldn't be shown anyway.
        await followUpNative.syncReminders([]);
        setState({ kind: 'blocked' });
        return;
      }
      const list = wanted ? buildReminders(data, new Date(), texts) : [];
      const result = await followUpNative.syncReminders(list);
      if (!result.ok) setState({ kind: result.error });
      else
        setState(
          wanted ? { kind: 'scheduled', count: result.value } : { kind: 'off' },
        );
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void sync();
      }, SYNC_DELAY_MS);
    };
    const unsubscribe = followUpStore.subscribe(schedule);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') schedule();
    });
    void sync();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      sub.remove();
    };
  }, [t]);
}
