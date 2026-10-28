import { diffDays, toDayKey, type DayKey } from '@/shared/utils/dayKey';
import type {
  Contact,
  ContactNote,
  FollowUpActivity,
  FollowUpData,
  FollowUpStatus,
} from '../types';
import { isOpen, nextBirthday, scheduledMs, statusOf } from './status';

export const FOLLOW_UP_VIEWS = [
  'pending',
  'today',
  'overdue',
  'upcoming',
  'done',
  'all',
] as const;
export type FollowUpView = (typeof FOLLOW_UP_VIEWS)[number];

export const SORTS = [
  'mostOverdue',
  'dueSoonest',
  'recentlyContacted',
  'recentlyAdded',
  'birthdays',
  'name',
] as const;
export type SortKey = (typeof SORTS)[number];

export interface Filters {
  query: string;
  categoryId: string;
  tagId: string;
  /** Inclusive day range on the follow-up's date (completion date for Done). */
  from: DayKey | '';
  to: DayKey | '';
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  categoryId: '',
  tagId: '',
  from: '',
  to: '',
};

/** One card per contact: the follow-up that put it in this view. */
export interface ContactRow {
  contact: Contact;
  /** The matching follow-up (next open one; latest completed for Done). */
  activity: FollowUpActivity | null;
  status: FollowUpStatus | null;
  /** Next open follow-up overall. */
  next: FollowUpActivity | null;
  /** Last completed follow-up or logged interaction (ISO). */
  lastContact: string;
  /** Latest note / completion summary. */
  latest: string;
  /** Days until the next birthday (0 = today), or null. */
  birthdayIn: number | null;
  /** Open follow-ups in this view beyond the shown one. */
  more: number;
}

export interface Summary {
  contacts: number;
  dueToday: number;
  overdue: number;
  doneToday: number;
  upcoming: number;
}

const byTime = (a: FollowUpActivity, b: FollowUpActivity) =>
  scheduledMs(a) - scheduledMs(b);

/** Counts from the persisted data (active contacts only). */
export function summarize(data: FollowUpData, now: Date): Summary {
  const active = new Set(data.contacts.filter(c => c.isActive).map(c => c.id));
  const today = toDayKey(now);
  const s: Summary = {
    contacts: active.size,
    dueToday: 0,
    overdue: 0,
    doneToday: 0,
    upcoming: 0,
  };
  for (const a of data.activities) {
    if (!active.has(a.contactId)) continue;
    const status = statusOf(a, now);
    if (status === 'completed') {
      if (toDayKey(new Date(a.completedAt)) === today) s.doneToday++;
    } else if (status === 'overdue') s.overdue++;
    else if (status === 'due') s.dueToday++;
    else if (status === 'scheduled') s.upcoming++;
  }
  return s;
}

function matchesView(
  a: FollowUpActivity,
  status: FollowUpStatus,
  view: FollowUpView,
  today: DayKey,
): boolean {
  switch (view) {
    case 'pending':
      return status === 'due' || status === 'overdue';
    case 'today':
      return isOpen(a) && a.day === today;
    case 'overdue':
      return status === 'overdue';
    case 'upcoming':
      return status === 'scheduled';
    case 'done':
      return status === 'completed';
    default:
      return false;
  }
}

function lastContactOf(
  activities: FollowUpActivity[],
  notes: ContactNote[],
): string {
  let last = '';
  for (const a of activities) if (a.completedAt > last) last = a.completedAt;
  for (const n of notes)
    if (n.kind !== 'note' && n.createdAt > last) last = n.createdAt;
  return last;
}

function latestSummary(
  activities: FollowUpActivity[],
  notes: ContactNote[],
): string {
  const items: { at: string; text: string }[] = [
    ...notes.map(n => ({ at: n.createdAt, text: n.content })),
    ...activities
      .filter(a => a.completedAt)
      .map(a => ({ at: a.completedAt, text: a.completionNote || a.purpose })),
  ].filter(x => x.text);
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  return items[0]?.text ?? '';
}

function inRange(day: DayKey, f: Filters): boolean {
  return (!f.from || day >= f.from) && (!f.to || day <= f.to);
}

export function matchesQuery(contact: Contact, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return (
    contact.name.toLocaleLowerCase().includes(q) ||
    contact.organization.toLocaleLowerCase().includes(q) ||
    (digits.length >= 3 &&
      (contact.e164.includes(digits) || contact.phone.includes(digits)))
  );
}

/**
 * The cards for a view: one per contact even when it has several follow-ups,
 * filtered and sorted. Pending/Today/Overdue/Upcoming/Done list active
 * contacts; All lists everyone.
 */
export function buildRows(
  data: FollowUpData,
  view: FollowUpView,
  filters: Filters,
  sort: SortKey,
  now: Date,
): ContactRow[] {
  const today = toDayKey(now);
  const activitiesBy = new Map<string, FollowUpActivity[]>();
  for (const a of data.activities) {
    const list = activitiesBy.get(a.contactId) ?? [];
    list.push(a);
    activitiesBy.set(a.contactId, list);
  }
  const notesBy = new Map<string, ContactNote[]>();
  for (const n of data.notes) {
    const list = notesBy.get(n.contactId) ?? [];
    list.push(n);
    notesBy.set(n.contactId, list);
  }

  const rows: ContactRow[] = [];
  for (const contact of data.contacts) {
    if (view !== 'all' && !contact.isActive) continue;
    if (!matchesQuery(contact, filters.query)) continue;
    if (filters.categoryId && contact.categoryId !== filters.categoryId)
      continue;
    if (filters.tagId && !contact.tagIds.includes(filters.tagId)) continue;
    const activities = activitiesBy.get(contact.id) ?? [];
    const notes = notesBy.get(contact.id) ?? [];
    const open = activities.filter(isOpen).sort(byTime);

    let matching: FollowUpActivity[];
    if (view === 'all') matching = open;
    else if (view === 'done')
      matching = activities
        .filter(a => a.completedAt)
        .filter(a => inRange(toDayKey(new Date(a.completedAt)), filters))
        .sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1));
    else
      matching = open.filter(
        a =>
          matchesView(a, statusOf(a, now), view, today) &&
          inRange(a.day, filters),
      );
    if (view !== 'all' && !matching.length) continue;
    if (view === 'all' && (filters.from || filters.to)) {
      if (!activities.some(a => inRange(a.day, filters))) continue;
    }

    const activity = matching[0] ?? null;
    rows.push({
      contact,
      activity,
      status: activity ? statusOf(activity, now) : null,
      next: open[0] ?? null,
      lastContact: lastContactOf(activities, notes),
      latest: latestSummary(activities, notes),
      birthdayIn: contact.birthDate
        ? diffDays(today, nextBirthday(contact.birthDate, today))
        : null,
      more: Math.max(0, matching.length - 1),
    });
  }
  return sortRows(rows, sort, view);
}

function sortRows(rows: ContactRow[], sort: SortKey, view: FollowUpView) {
  const when = (r: ContactRow) => {
    const a = r.activity ?? r.next;
    return a ? scheduledMs(a) : Number.POSITIVE_INFINITY;
  };
  const byName = (a: ContactRow, b: ContactRow) =>
    a.contact.name.localeCompare(b.contact.name);
  const compare: Record<SortKey, (a: ContactRow, b: ContactRow) => number> = {
    mostOverdue: (a, b) => when(a) - when(b) || byName(a, b),
    dueSoonest: (a, b) => when(a) - when(b) || byName(a, b),
    recentlyContacted: (a, b) =>
      (a.lastContact < b.lastContact
        ? 1
        : a.lastContact > b.lastContact
        ? -1
        : 0) || byName(a, b),
    recentlyAdded: (a, b) =>
      (a.contact.createdAt < b.contact.createdAt ? 1 : -1) || byName(a, b),
    birthdays: (a, b) =>
      (a.birthdayIn ?? 999) - (b.birthdayIn ?? 999) || byName(a, b),
    name: byName,
  };
  // Done is newest-completed first unless another order is chosen.
  if (view === 'done' && (sort === 'mostOverdue' || sort === 'dueSoonest'))
    return rows.sort((a, b) =>
      (a.activity?.completedAt ?? '') < (b.activity?.completedAt ?? '')
        ? 1
        : -1,
    );
  return rows.sort(compare[sort]);
}

/** Contacts with a birthday in the next [days] days, soonest first. */
export function upcomingBirthdays(
  data: FollowUpData,
  today: DayKey,
  days = 30,
): { contact: Contact; day: DayKey; inDays: number }[] {
  return data.contacts
    .filter(c => c.isActive && c.birthDate)
    .map(contact => {
      const day = nextBirthday(contact.birthDate, today);
      return { contact, day, inDays: diffDays(today, day) };
    })
    .filter(b => b.inDays <= days)
    .sort((a, b) => a.inDays - b.inDays);
}

export type TimelineItem =
  | { kind: 'scheduled'; at: string; activity: FollowUpActivity }
  | { kind: 'completed'; at: string; activity: FollowUpActivity }
  | { kind: 'cancelled'; at: string; activity: FollowUpActivity }
  | { kind: 'note'; at: string; note: ContactNote }
  | {
      kind: 'event';
      at: string;
      event: FollowUpData['events'][number];
    };

/** Everything that happened with a contact, newest first. */
export function timelineOf(
  data: FollowUpData,
  contactId: string,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const a of data.activities) {
    if (a.contactId !== contactId) continue;
    items.push({ kind: 'scheduled', at: a.createdAt, activity: a });
    if (a.completedAt)
      items.push({ kind: 'completed', at: a.completedAt, activity: a });
    else if (a.cancelled)
      items.push({ kind: 'cancelled', at: a.updatedAt, activity: a });
  }
  for (const note of data.notes)
    if (note.contactId === contactId)
      items.push({ kind: 'note', at: note.createdAt, note });
  for (const event of data.events)
    if (event.contactId === contactId)
      items.push({ kind: 'event', at: event.at, event });
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
