import { getCountry } from 'react-native-localize';
import { COUNTRIES } from '@/shared/components';
import { createLocalId as createId } from '@/shared/utils';
import { isDayKey, type DayKey } from '@/shared/utils/dayKey';
import { storage, StorageKeys } from '@/store/mmkv';
import type {
  Attachment,
  Category,
  Contact,
  ContactEvent,
  ContactEventKind,
  ContactNote,
  DefaultView,
  FollowUpActivity,
  FollowUpData,
  FollowUpSettings,
  FollowUpType,
  NoteKind,
  Outcome,
  Tag,
  TimeKey,
} from '../types';
import {
  DEFAULT_VIEWS,
  FOLLOW_UP_TYPES,
  LEAD_MINUTES,
  OUTCOMES,
} from '../types';
import { isValidDial, parsePhone, type PhoneError } from '../utils/phone';
import { isTimeKey } from '../utils/time';

/**
 * Follow Up persistence (MMKV, private to this device). One key per
 * collection; every record is validated on load (a bad record is dropped,
 * never crashes the app). All writes go through here, bump `version` and
 * notify subscribers. Completed follow-ups are never overwritten — a new
 * follow-up is always a new record.
 */

export const SCHEMA_VERSION = 1;
export const MAX_NAME = 80;
export const MAX_TEXT = 1000;
/** Same follow-up submitted twice within this window = an accidental double tap. */
export const DUPLICATE_WINDOW_MS = 5000;

const KEYS = {
  meta: StorageKeys.FollowUpMeta,
  contacts: StorageKeys.FollowUpContacts,
  activities: StorageKeys.FollowUpActivities,
  notes: StorageKeys.FollowUpNotes,
  events: StorageKeys.FollowUpEvents,
  categories: StorageKeys.FollowUpCategories,
  tags: StorageKeys.FollowUpTags,
  settings: StorageKeys.FollowUpSettings,
} as const;

export type FollowUpError =
  | PhoneError
  | 'name_required'
  | 'name_taken'
  | 'email_invalid'
  | 'date_invalid'
  | 'time_invalid'
  | 'note_required'
  | 'not_found'
  | 'duplicate'
  | 'already_completed';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: FollowUpError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: FollowUpError): Result<T> => ({ ok: false, error });

// ── Validation on load ─────────────────────────────────────────────────

type R = Record<string, unknown>;
const str = (v: unknown, max = MAX_TEXT) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const iso = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '';
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;
const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const NOTE_KINDS: readonly NoteKind[] = ['note', 'call', 'whatsapp', 'meeting'];
const EVENT_KINDS: readonly ContactEventKind[] = [
  'dialer_opened',
  'whatsapp_opened',
  'rescheduled',
];

function cleanContact(r: R): Contact | null {
  const e164 = str(r.e164, 15);
  if (typeof r.id !== 'string' || !str(r.name) || !/^\d{8,15}$/.test(e164))
    return null;
  return {
    id: r.id,
    name: str(r.name, MAX_NAME),
    dial: isValidDial(str(r.dial, 5)) ? str(r.dial, 5) : '',
    phone: str(r.phone, 15),
    e164,
    birthDate: isDayKey(r.birthDate) ? r.birthDate : '',
    email: str(r.email, 200),
    organization: str(r.organization, MAX_NAME),
    location: str(r.location, 200),
    categoryId: str(r.categoryId, 60),
    tagIds: strings(r.tagIds),
    notes: str(r.notes),
    photoUri: str(r.photoUri, 1000),
    isActive: r.isActive !== false,
    createdAt: iso(r.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(r.updatedAt) || new Date(0).toISOString(),
  };
}

function cleanActivity(r: R): FollowUpActivity | null {
  if (
    typeof r.id !== 'string' ||
    typeof r.contactId !== 'string' ||
    !isDayKey(r.day)
  )
    return null;
  const completedAt = iso(r.completedAt);
  return {
    id: r.id,
    contactId: r.contactId,
    day: r.day,
    time: isTimeKey(r.time) ? r.time : '',
    type: oneOf(r.type, FOLLOW_UP_TYPES, 'call'),
    purpose: str(r.purpose),
    reminder: r.reminder === true,
    cancelled: !completedAt && r.cancelled === true,
    completedAt,
    outcome: completedAt ? oneOf<Outcome | ''>(r.outcome, OUTCOMES, '') : '',
    completionNote: str(r.completionNote),
    nextActivityId: str(r.nextActivityId, 60),
    createdAt: iso(r.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(r.updatedAt) || new Date(0).toISOString(),
  };
}

function cleanAttachment(v: unknown): Attachment | null {
  if (!v || typeof v !== 'object') return null;
  const a = v as R;
  const uri = str(a.uri, 1000);
  return uri ? { uri, name: str(a.name, 200), mime: str(a.mime, 100) } : null;
}

function cleanNote(r: R): ContactNote | null {
  if (typeof r.id !== 'string' || typeof r.contactId !== 'string') return null;
  const attachment = cleanAttachment(r.attachment);
  const content = str(r.content);
  if (!content && !attachment) return null;
  return {
    id: r.id,
    contactId: r.contactId,
    activityId: str(r.activityId, 60),
    kind: oneOf(r.kind, NOTE_KINDS, 'note'),
    content,
    attachment,
    createdAt: iso(r.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(r.updatedAt) || new Date(0).toISOString(),
  };
}

function cleanEvent(r: R): ContactEvent | null {
  if (typeof r.id !== 'string' || typeof r.contactId !== 'string') return null;
  const at = iso(r.at);
  if (!at || !EVENT_KINDS.includes(r.kind as ContactEventKind)) return null;
  return {
    id: r.id,
    contactId: r.contactId,
    kind: r.kind as ContactEventKind,
    detail: str(r.detail, 100),
    at,
  };
}

function cleanCategory(r: R): Category | null {
  if (typeof r.id !== 'string' || !str(r.name)) return null;
  return {
    id: r.id,
    name: str(r.name, MAX_NAME),
    color: str(r.color, 20) || 'violet',
    icon: str(r.icon, 40) || 'tag',
    isActive: r.isActive !== false,
  };
}

function cleanTag(r: R): Tag | null {
  if (typeof r.id !== 'string' || !str(r.name)) return null;
  return {
    id: r.id,
    name: str(r.name, MAX_NAME),
    color: str(r.color, 20) || 'blue',
    isActive: r.isActive !== false,
  };
}

/** The device region's calling code, else the first in the picker list. */
function regionDial(): string {
  try {
    const iso2 = getCountry()?.toLowerCase();
    const match = COUNTRIES.find(c => c.iso === iso2);
    if (match) return match.dial;
  } catch {
    // Unknown region: fall through to the default below.
  }
  return COUNTRIES[0].dial;
}

export function defaultSettings(): FollowUpSettings {
  return {
    defaultDial: regionDial(),
    defaultType: 'call',
    remindersEnabled: false,
    reminderByDefault: true,
    leadMinutes: 0,
    preferredTime: '10:00',
    overdueReminders: true,
    birthdayReminders: false,
    defaultView: 'today',
  };
}

function cleanSettings(v: unknown): FollowUpSettings {
  const d = defaultSettings();
  if (!v || typeof v !== 'object') return d;
  const r = v as R;
  return {
    defaultDial: isValidDial(str(r.defaultDial, 5))
      ? str(r.defaultDial, 5)
      : d.defaultDial,
    defaultType: oneOf(r.defaultType, FOLLOW_UP_TYPES, d.defaultType),
    remindersEnabled: r.remindersEnabled === true,
    reminderByDefault: r.reminderByDefault !== false,
    leadMinutes: (LEAD_MINUTES as readonly number[]).includes(
      r.leadMinutes as number,
    )
      ? (r.leadMinutes as number)
      : d.leadMinutes,
    preferredTime: isTimeKey(r.preferredTime)
      ? r.preferredTime
      : d.preferredTime,
    overdueReminders: r.overdueReminders !== false,
    birthdayReminders: r.birthdayReminders === true,
    defaultView: oneOf<DefaultView>(
      r.defaultView,
      DEFAULT_VIEWS,
      d.defaultView,
    ),
  };
}

function readList<T>(key: string, clean: (r: R) => T | null): T[] {
  try {
    const raw = storage.getString(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(x => (x && typeof x === 'object' ? clean(x as R) : null))
      .filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

function load(): FollowUpData {
  let meta: R = {};
  let settings: unknown = null;
  try {
    meta = JSON.parse(storage.getString(KEYS.meta) ?? '{}') as R;
    settings = JSON.parse(storage.getString(KEYS.settings) ?? 'null');
  } catch {
    meta = {};
  }
  // Future schema changes migrate here, keyed on meta.schemaVersion.
  return {
    version: Number.isInteger(meta.version) ? (meta.version as number) : 0,
    contacts: readList(KEYS.contacts, cleanContact),
    activities: readList(KEYS.activities, cleanActivity),
    notes: readList(KEYS.notes, cleanNote),
    events: readList(KEYS.events, cleanEvent),
    categories: readList(KEYS.categories, cleanCategory),
    tags: readList(KEYS.tags, cleanTag),
    settings: cleanSettings(settings),
  };
}

// ── Store ──────────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: FollowUpData | null = null;

type Collection = Exclude<keyof FollowUpData, 'version'>;

function read(): FollowUpData {
  if (!cache) cache = load();
  return cache;
}

function commit(next: Omit<FollowUpData, 'version'>, changed: Collection[]) {
  const prev = read();
  cache = { ...next, version: prev.version + 1 };
  for (const c of changed) storage.set(KEYS[c], JSON.stringify(cache[c]));
  storage.set(
    KEYS.meta,
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, version: cache.version }),
  );
  listeners.forEach(l => l());
}

const now = () => new Date().toISOString();
const clip = (s: string | undefined, max = MAX_TEXT) =>
  (s ?? '').trim().slice(0, max);
const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Inputs ─────────────────────────────────────────────────────────────

export interface ContactInput {
  name: string;
  dial: string;
  phone: string;
  birthDate?: DayKey | '';
  email?: string;
  organization?: string;
  location?: string;
  categoryId?: string;
  tagIds?: string[];
  notes?: string;
  photoUri?: string;
}

export interface ScheduleInput {
  day: DayKey;
  time?: TimeKey;
  type: FollowUpType;
  purpose?: string;
  reminder?: boolean;
}

export interface CompleteInput {
  outcome: Outcome;
  note?: string;
  /** Defaults to now. */
  completedAt?: Date;
  next?: ScheduleInput;
}

/** Field-level validation for the contact form (null = valid). */
export function validateContact(input: ContactInput): FollowUpError | null {
  if (!input.name.trim()) return 'name_required';
  const phone = parsePhone(input.phone, input.dial);
  if (!phone.ok) return phone.error;
  if (input.birthDate && !isDayKey(input.birthDate)) return 'date_invalid';
  if (input.email?.trim() && !EMAIL_RE.test(input.email.trim()))
    return 'email_invalid';
  return null;
}

export function validateSchedule(input: ScheduleInput): FollowUpError | null {
  if (!isDayKey(input.day)) return 'date_invalid';
  if (input.time && !isTimeKey(input.time)) return 'time_invalid';
  return null;
}

function buildContact(
  input: ContactInput,
  base: Pick<Contact, 'id' | 'isActive' | 'createdAt'>,
): Result<Contact> {
  const error = validateContact(input);
  if (error) return fail(error);
  const phone = parsePhone(input.phone, input.dial);
  if (!phone.ok) return fail(phone.error);
  const d = read();
  return ok({
    ...base,
    name: clip(input.name, MAX_NAME),
    ...phone.value,
    birthDate: input.birthDate || '',
    email: clip(input.email, 200),
    organization: clip(input.organization, MAX_NAME),
    location: clip(input.location, 200),
    categoryId: d.categories.some(c => c.id === input.categoryId)
      ? input.categoryId!
      : '',
    tagIds: [...new Set(input.tagIds ?? [])].filter(id =>
      d.tags.some(t => t.id === id),
    ),
    notes: clip(input.notes),
    photoUri: input.photoUri ?? '',
    updatedAt: now(),
  });
}

function buildActivity(
  contactId: string,
  input: ScheduleInput,
): FollowUpActivity {
  const t = now();
  return {
    id: createId(),
    contactId,
    day: input.day,
    time: input.time ?? '',
    type: input.type,
    purpose: clip(input.purpose),
    reminder: input.reminder ?? false,
    cancelled: false,
    completedAt: '',
    outcome: '',
    completionNote: '',
    nextActivityId: '',
    createdAt: t,
    updatedAt: t,
  };
}

function event(
  contactId: string,
  kind: ContactEventKind,
  detail = '',
): ContactEvent {
  return { id: createId(), contactId, kind, detail, at: now() };
}

function patchActivity(
  id: string,
  change: (a: FollowUpActivity) => FollowUpActivity,
  extra: Partial<Pick<FollowUpData, 'events' | 'activities'>> = {},
): Result<FollowUpActivity> {
  const d = read();
  const existing = d.activities.find(a => a.id === id);
  if (!existing) return fail('not_found');
  const activity = { ...change(existing), updatedAt: now() };
  const activities = (extra.activities ?? d.activities).map(a =>
    a.id === id ? activity : a,
  );
  commit(
    { ...d, activities, events: extra.events ?? d.events },
    extra.events ? ['activities', 'events'] : ['activities'],
  );
  return ok(activity);
}

export const followUpStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // ── Contacts ──

  /** Another contact with the same normalised number, if any. */
  findDuplicate(
    phone: string,
    dial: string,
    exceptId?: string,
  ): Contact | null {
    const parsed = parsePhone(phone, dial);
    if (!parsed.ok) return null;
    return (
      read().contacts.find(
        c => c.e164 === parsed.value.e164 && c.id !== exceptId,
      ) ?? null
    );
  },

  createContact(input: ContactInput, first?: ScheduleInput): Result<Contact> {
    if (first) {
      const error = validateSchedule(first);
      if (error) return fail(error);
    }
    const t = now();
    const built = buildContact(input, {
      id: createId(),
      isActive: true,
      createdAt: t,
    });
    if (!built.ok) return built;
    const d = read();
    const activities = first
      ? [...d.activities, buildActivity(built.value.id, first)]
      : d.activities;
    commit(
      { ...d, contacts: [...d.contacts, built.value], activities },
      first ? ['contacts', 'activities'] : ['contacts'],
    );
    return built;
  },

  updateContact(id: string, input: ContactInput): Result<Contact> {
    const d = read();
    const existing = d.contacts.find(c => c.id === id);
    if (!existing) return fail('not_found');
    const built = buildContact(input, existing);
    if (!built.ok) return built;
    commit(
      { ...d, contacts: d.contacts.map(c => (c.id === id ? built.value : c)) },
      ['contacts'],
    );
    return built;
  },

  setContactActive(id: string, isActive: boolean): Result<Contact> {
    const d = read();
    const existing = d.contacts.find(c => c.id === id);
    if (!existing) return fail('not_found');
    const contact = { ...existing, isActive, updatedAt: now() };
    commit(
      { ...d, contacts: d.contacts.map(c => (c.id === id ? contact : c)) },
      ['contacts'],
    );
    return ok(contact);
  },

  /** Deletes the contact with its follow-ups, notes and timeline. */
  deleteContact(id: string): Result<null> {
    const d = read();
    if (!d.contacts.some(c => c.id === id)) return fail('not_found');
    commit(
      {
        ...d,
        contacts: d.contacts.filter(c => c.id !== id),
        activities: d.activities.filter(a => a.contactId !== id),
        notes: d.notes.filter(n => n.contactId !== id),
        events: d.events.filter(e => e.contactId !== id),
      },
      ['contacts', 'activities', 'notes', 'events'],
    );
    return ok(null);
  },

  // ── Follow-ups ──

  schedule(contactId: string, input: ScheduleInput): Result<FollowUpActivity> {
    const error = validateSchedule(input);
    if (error) return fail(error);
    const d = read();
    if (!d.contacts.some(c => c.id === contactId)) return fail('not_found');
    const recent = d.activities.find(
      a =>
        a.contactId === contactId &&
        a.day === input.day &&
        a.time === (input.time ?? '') &&
        a.type === input.type &&
        Date.now() - Date.parse(a.createdAt) < DUPLICATE_WINDOW_MS,
    );
    if (recent) return fail('duplicate');
    const activity = buildActivity(contactId, input);
    commit({ ...d, activities: [...d.activities, activity] }, ['activities']);
    return ok(activity);
  },

  /** Changes an open follow-up; a date/time change is kept in the timeline. */
  editFollowUp(id: string, input: ScheduleInput): Result<FollowUpActivity> {
    const error = validateSchedule(input);
    if (error) return fail(error);
    const d = read();
    const existing = d.activities.find(a => a.id === id);
    if (!existing) return fail('not_found');
    if (existing.completedAt) return fail('already_completed');
    const time = input.time ?? '';
    const moved = existing.day !== input.day || existing.time !== time;
    const events = moved
      ? [
          ...d.events,
          event(
            existing.contactId,
            'rescheduled',
            `${existing.day} ${existing.time}`.trim() +
              ' → ' +
              `${input.day} ${time}`.trim(),
          ),
        ]
      : undefined;
    return patchActivity(
      id,
      a => ({
        ...a,
        day: input.day,
        time,
        type: input.type,
        purpose: clip(input.purpose),
        reminder: input.reminder ?? a.reminder,
      }),
      { events },
    );
  },

  setCancelled(id: string, cancelled: boolean): Result<FollowUpActivity> {
    const existing = read().activities.find(a => a.id === id);
    if (existing?.completedAt) return fail('already_completed');
    return patchActivity(id, a => ({ ...a, cancelled }));
  },

  deleteFollowUp(id: string): Result<null> {
    const d = read();
    if (!d.activities.some(a => a.id === id)) return fail('not_found');
    commit(
      {
        ...d,
        activities: d.activities
          .filter(a => a.id !== id)
          .map(a =>
            a.nextActivityId === id ? { ...a, nextActivityId: '' } : a,
          ),
        notes: d.notes.map(n =>
          n.activityId === id ? { ...n, activityId: '' } : n,
        ),
      },
      ['activities', 'notes'],
    );
    return ok(null);
  },

  /**
   * Completes a follow-up with its outcome. The completed record is kept as
   * is; a next follow-up, when given, is a new record linked from it.
   */
  complete(id: string, input: CompleteInput): Result<FollowUpActivity> {
    const d = read();
    const existing = d.activities.find(a => a.id === id);
    if (!existing) return fail('not_found');
    if (existing.completedAt) return fail('already_completed');
    if (input.next) {
      const error = validateSchedule(input.next);
      if (error) return fail(error);
    }
    const next = input.next
      ? buildActivity(existing.contactId, input.next)
      : null;
    return patchActivity(
      id,
      a => ({
        ...a,
        cancelled: false,
        completedAt: (input.completedAt ?? new Date()).toISOString(),
        outcome: input.outcome,
        completionNote: clip(input.note),
        nextActivityId: next?.id ?? '',
      }),
      next ? { activities: [...d.activities, next] } : {},
    );
  },

  // ── Notes & timeline ──

  addNote(input: {
    contactId: string;
    kind: NoteKind;
    content: string;
    activityId?: string;
    attachment?: Attachment | null;
  }): Result<ContactNote> {
    const content = clip(input.content);
    if (!content && !input.attachment) return fail('note_required');
    const d = read();
    if (!d.contacts.some(c => c.id === input.contactId))
      return fail('not_found');
    const t = now();
    const note: ContactNote = {
      id: createId(),
      contactId: input.contactId,
      activityId: input.activityId ?? '',
      kind: input.kind,
      content,
      attachment: input.attachment ?? null,
      createdAt: t,
      updatedAt: t,
    };
    commit({ ...d, notes: [...d.notes, note] }, ['notes']);
    return ok(note);
  },

  deleteNote(id: string): Result<null> {
    const d = read();
    if (!d.notes.some(n => n.id === id)) return fail('not_found');
    commit({ ...d, notes: d.notes.filter(n => n.id !== id) }, ['notes']);
    return ok(null);
  },

  /** Records something the app did (opened the dialer / WhatsApp). */
  logEvent(contactId: string, kind: 'dialer_opened' | 'whatsapp_opened') {
    const d = read();
    if (!d.contacts.some(c => c.id === contactId)) return;
    commit({ ...d, events: [...d.events, event(contactId, kind)] }, ['events']);
  },

  // ── Categories & tags ──

  saveCategory(
    input: Pick<Category, 'name' | 'color' | 'icon'> & { id?: string },
  ): Result<Category> {
    const name = clip(input.name, MAX_NAME);
    if (!name) return fail('name_required');
    const d = read();
    if (d.categories.some(c => c.id !== input.id && sameName(c.name, name)))
      return fail('name_taken');
    const existing = d.categories.find(c => c.id === input.id);
    const category: Category = {
      id: existing?.id ?? createId(),
      name,
      color: input.color,
      icon: input.icon,
      isActive: existing?.isActive ?? true,
    };
    commit(
      {
        ...d,
        categories: existing
          ? d.categories.map(c => (c.id === category.id ? category : c))
          : [...d.categories, category],
      },
      ['categories'],
    );
    return ok(category);
  },

  setCategoryActive(id: string, isActive: boolean): Result<null> {
    const d = read();
    if (!d.categories.some(c => c.id === id)) return fail('not_found');
    commit(
      {
        ...d,
        categories: d.categories.map(c =>
          c.id === id ? { ...c, isActive } : c,
        ),
      },
      ['categories'],
    );
    return ok(null);
  },

  /** Deletes a category; its contacts become uncategorised. */
  deleteCategory(id: string): Result<number> {
    const d = read();
    if (!d.categories.some(c => c.id === id)) return fail('not_found');
    const affected = d.contacts.filter(c => c.categoryId === id).length;
    commit(
      {
        ...d,
        categories: d.categories.filter(c => c.id !== id),
        contacts: d.contacts.map(c =>
          c.categoryId === id ? { ...c, categoryId: '', updatedAt: now() } : c,
        ),
      },
      ['categories', 'contacts'],
    );
    return ok(affected);
  },

  saveTag(input: Pick<Tag, 'name' | 'color'> & { id?: string }): Result<Tag> {
    const name = clip(input.name, MAX_NAME);
    if (!name) return fail('name_required');
    const d = read();
    if (d.tags.some(t => t.id !== input.id && sameName(t.name, name)))
      return fail('name_taken');
    const existing = d.tags.find(t => t.id === input.id);
    const tag: Tag = {
      id: existing?.id ?? createId(),
      name,
      color: input.color,
      isActive: existing?.isActive ?? true,
    };
    commit(
      {
        ...d,
        tags: existing
          ? d.tags.map(t => (t.id === tag.id ? tag : t))
          : [...d.tags, tag],
      },
      ['tags'],
    );
    return ok(tag);
  },

  setTagActive(id: string, isActive: boolean): Result<null> {
    const d = read();
    if (!d.tags.some(t => t.id === id)) return fail('not_found');
    commit(
      { ...d, tags: d.tags.map(t => (t.id === id ? { ...t, isActive } : t)) },
      ['tags'],
    );
    return ok(null);
  },

  /** Deletes a tag and removes it from every contact. */
  deleteTag(id: string): Result<number> {
    const d = read();
    if (!d.tags.some(t => t.id === id)) return fail('not_found');
    const affected = d.contacts.filter(c => c.tagIds.includes(id)).length;
    commit(
      {
        ...d,
        tags: d.tags.filter(t => t.id !== id),
        contacts: d.contacts.map(c =>
          c.tagIds.includes(id)
            ? { ...c, tagIds: c.tagIds.filter(x => x !== id), updatedAt: now() }
            : c,
        ),
      },
      ['tags', 'contacts'],
    );
    return ok(affected);
  },

  /**
   * Adds suggested categories and tags (names already translated by the
   * caller), skipping any name that exists. Returns how many were added.
   */
  addSuggestions(
    categories: readonly Pick<Category, 'name' | 'color' | 'icon'>[],
    tags: readonly Pick<Tag, 'name' | 'color'>[],
  ): number {
    const d = read();
    const newCats = categories
      .filter(c => !d.categories.some(x => sameName(x.name, c.name)))
      .map(c => ({ ...c, id: createId(), isActive: true }));
    const newTags = tags
      .filter(t => !d.tags.some(x => sameName(x.name, t.name)))
      .map(t => ({ ...t, id: createId(), isActive: true }));
    if (!newCats.length && !newTags.length) return 0;
    commit(
      {
        ...d,
        categories: [...d.categories, ...newCats],
        tags: [...d.tags, ...newTags],
      },
      ['categories', 'tags'],
    );
    return newCats.length + newTags.length;
  },

  // ── Settings & data ──

  updateSettings(patch: Partial<FollowUpSettings>): FollowUpSettings {
    const d = read();
    const settings = cleanSettings({ ...d.settings, ...patch });
    commit({ ...d, settings }, ['settings']);
    return settings;
  },

  /** Deletes every contact, follow-up, note, category and tag. Settings stay. */
  deleteAll() {
    const d = read();
    commit(
      {
        ...d,
        contacts: [],
        activities: [],
        notes: [],
        events: [],
        categories: [],
        tags: [],
      },
      ['contacts', 'activities', 'notes', 'events', 'categories', 'tags'],
    );
  },

  /** Tests only. */
  resetCacheForTest() {
    cache = null;
  },
};
