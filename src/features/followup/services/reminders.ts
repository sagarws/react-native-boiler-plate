import { addDays, toDayKey } from '@/shared/utils/dayKey';
import type { Contact, FollowUpActivity, FollowUpData } from '../types';
import { instantOf } from '../utils/time';
import type { NativeReminder } from './native.service';
import { isOpen, nextBirthday } from './status';

/** Android caps an app at 500 alarms; keep well below it. */
export const MAX_REMINDERS = 200;

/** Translated reminder texts; built by the hook layer. */
export interface ReminderTexts {
  due: (
    contact: Contact,
    activity: FollowUpActivity,
  ) => { title: string; body: string };
  overdue: (
    contact: Contact,
    activity: FollowUpActivity,
  ) => { title: string; body: string };
  birthday: (contact: Contact) => { title: string; body: string };
}

/**
 * Every reminder that should currently exist, soonest first. Recomputed
 * from the data on each change and handed to Android as a whole set, so a
 * changed date reschedules, and a completed, cancelled or deleted follow-up
 * (or a deleted contact) simply drops out — no stale or duplicate alarms.
 * - follow-up with a reminder: at its time (or the preferred time when it has
 *   none) minus the lead time;
 * - overdue nudge (if on): the next morning at the preferred time, if still open;
 * - birthday (if on): the next birthday at the preferred time.
 */
export function buildReminders(
  data: FollowUpData,
  now: Date,
  texts: ReminderTexts,
): NativeReminder[] {
  const s = data.settings;
  const out: NativeReminder[] = [];
  const nowMs = now.getTime();
  const contacts = new Map(
    data.contacts.filter(c => c.isActive).map(c => [c.id, c]),
  );
  if (s.remindersEnabled) {
    for (const a of data.activities) {
      const contact = contacts.get(a.contactId);
      if (!contact || !isOpen(a) || !a.reminder) continue;
      const due =
        instantOf(a.day, a.time || s.preferredTime).getTime() -
        s.leadMinutes * 60_000;
      if (due > nowMs)
        out.push({
          key: `due:${a.id}`,
          at: due,
          contactId: contact.id,
          ...texts.due(contact, a),
        });
      if (s.overdueReminders) {
        const nudge = instantOf(addDays(a.day, 1), s.preferredTime).getTime();
        if (nudge > nowMs)
          out.push({
            key: `over:${a.id}`,
            at: nudge,
            contactId: contact.id,
            ...texts.overdue(contact, a),
          });
      }
    }
  }
  if (s.birthdayReminders) {
    const today = toDayKey(now);
    for (const contact of contacts.values()) {
      if (!contact.birthDate) continue;
      let day = nextBirthday(contact.birthDate, today);
      let at = instantOf(day, s.preferredTime).getTime();
      // Today's reminder time has passed: next year's.
      if (at <= nowMs) {
        day = nextBirthday(contact.birthDate, addDays(today, 1));
        at = instantOf(day, s.preferredTime).getTime();
      }
      out.push({
        key: `bday:${contact.id}`,
        at,
        contactId: contact.id,
        ...texts.birthday(contact),
      });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, MAX_REMINDERS);
}
