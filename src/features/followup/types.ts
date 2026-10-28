import type { DayKey } from '@/shared/utils/dayKey';

export type { DayKey };

/** "HH:MM" (24 h), or '' for a follow-up with no set time. */
export type TimeKey = string;

export const FOLLOW_UP_TYPES = [
  'call',
  'whatsapp',
  'meeting',
  'other',
] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];

export const OUTCOMES = [
  'successful',
  'no_answer',
  'call_back',
  'message_sent',
  'meeting_done',
  'not_interested',
  'other',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * Derived, never stored: Scheduled (later), Due (today, time not yet passed),
 * Overdue (day over, or time passed), Completed, Cancelled.
 */
export type FollowUpStatus =
  | 'scheduled'
  | 'due'
  | 'overdue'
  | 'completed'
  | 'cancelled';

export interface Contact {
  id: string;
  name: string;
  /** Country calling code, "+44". */
  dial: string;
  /** National number as digits (trunk "0" removed). */
  phone: string;
  /** Full international number as digits only (dial + national), for tel:/wa.me. */
  e164: string;
  birthDate: DayKey | '';
  email: string;
  organization: string;
  location: string;
  categoryId: string;
  tagIds: string[];
  notes: string;
  photoUri: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUpActivity {
  id: string;
  contactId: string;
  day: DayKey;
  time: TimeKey;
  type: FollowUpType;
  purpose: string;
  reminder: boolean;
  cancelled: boolean;
  /** ISO instant, '' while open. */
  completedAt: string;
  outcome: Outcome | '';
  completionNote: string;
  /** The follow-up scheduled when this one was completed, if any. */
  nextActivityId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a note records. `note` is free text; `call` / `whatsapp` / `meeting`
 * are interactions the user logged themselves (the app can't see whether a
 * call connected or a message was sent).
 */
export type NoteKind = 'note' | 'call' | 'whatsapp' | 'meeting';

export interface Attachment {
  uri: string;
  name: string;
  mime: string;
}

export interface ContactNote {
  id: string;
  contactId: string;
  activityId: string;
  kind: NoteKind;
  content: string;
  attachment: Attachment | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Things the app itself observed: it opened the dialer or WhatsApp, or a
 * follow-up was moved. Shown in the timeline apart from user-recorded notes.
 */
export type ContactEventKind =
  | 'dialer_opened'
  | 'whatsapp_opened'
  | 'rescheduled';

export interface ContactEvent {
  id: string;
  contactId: string;
  kind: ContactEventKind;
  /** For `rescheduled`: "old → new" day/time; otherwise ''. */
  detail: string;
  at: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  isActive: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  isActive: boolean;
}

export const DEFAULT_VIEWS = ['today', 'pending', 'upcoming'] as const;
export type DefaultView = (typeof DEFAULT_VIEWS)[number];

export const LEAD_MINUTES = [0, 15, 30, 60, 1440] as const;

export interface FollowUpSettings {
  defaultDial: string;
  defaultType: FollowUpType;
  /** Master switch for follow-up reminders. */
  remindersEnabled: boolean;
  /** New follow-ups get a reminder by default. */
  reminderByDefault: boolean;
  /** Minutes before the follow-up (0 = at the time). */
  leadMinutes: number;
  /** Reminder time for follow-ups without a time, and for birthdays. */
  preferredTime: TimeKey;
  /** Also remind the next morning when a follow-up is still open. */
  overdueReminders: boolean;
  birthdayReminders: boolean;
  defaultView: DefaultView;
}

export interface FollowUpData {
  version: number;
  contacts: Contact[];
  activities: FollowUpActivity[];
  notes: ContactNote[];
  events: ContactEvent[];
  categories: Category[];
  tags: Tag[];
  settings: FollowUpSettings;
}
