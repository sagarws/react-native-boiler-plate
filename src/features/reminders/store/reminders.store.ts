import { cleanAlert, REPEATS, type Repeat } from '@/services/alarms';
import { createLocalId as createId } from '@/shared/utils';
import { isDayKey } from '@/shared/utils/dayKey';
import { storage, StorageKeys } from '@/store/mmkv';
import { MAX_DESCRIPTION, MAX_TITLE, validate } from '../services/reminders';
import {
  CATEGORIES,
  type Reminder,
  type ReminderCategory,
  type ReminderError,
  type ReminderInput,
} from '../types';

/**
 * Reminders persistence (MMKV). The native alarm engine keeps its own copy
 * of what to ring (so alarms survive reboots with the app closed); this is
 * the source of truth it's synced from. Bad records are dropped on load.
 */

export const MAX_REMINDERS = 250;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

type R = Record<string, unknown>;
type Result<T> = { ok: true; value: T } | { ok: false; error: ReminderError };

const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
const iso = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))
    ? v
    : new Date(0).toISOString();

function clean(r: R): Reminder | null {
  if (
    typeof r.id !== 'string' ||
    !str(r.title, MAX_TITLE) ||
    !isDayKey(r.date) ||
    typeof r.time !== 'string' ||
    !TIME.test(r.time)
  )
    return null;
  return {
    id: r.id,
    title: str(r.title, MAX_TITLE),
    description: str(r.description, MAX_DESCRIPTION),
    date: r.date,
    time: r.time,
    category: CATEGORIES.includes(r.category as ReminderCategory)
      ? (r.category as ReminderCategory)
      : 'personal',
    customLabel: str(r.customLabel, 30),
    repeat: REPEATS.includes(r.repeat as Repeat)
      ? (r.repeat as Repeat)
      : 'never',
    enabled: r.enabled !== false,
    alert: cleanAlert(r.alert),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function load(): Reminder[] {
  try {
    const parsed: unknown = JSON.parse(
      storage.getString(StorageKeys.Reminders) ?? '[]',
    );
    return Array.isArray(parsed)
      ? parsed
          .map(x => (x && typeof x === 'object' ? clean(x as R) : null))
          .filter((x): x is Reminder => x !== null)
      : [];
  } catch {
    return [];
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: Reminder[] | null = null;

function read(): Reminder[] {
  if (!cache) cache = load();
  return cache;
}

function commit(next: Reminder[]) {
  cache = next;
  storage.set(StorageKeys.Reminders, JSON.stringify(next));
  listeners.forEach(l => l());
}

const normalize = (input: ReminderInput) => ({
  title: input.title.trim().slice(0, MAX_TITLE),
  description: input.description.trim().slice(0, MAX_DESCRIPTION),
  date: input.date,
  time: input.time,
  category: input.category,
  customLabel:
    input.category === 'custom' ? input.customLabel.trim().slice(0, 30) : '',
  repeat: input.repeat,
  alert: cleanAlert(input.alert),
});

export const remindersStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  create(input: ReminderInput, now = Date.now()): Result<Reminder> {
    const list = read();
    if (list.length >= MAX_REMINDERS) return { ok: false, error: 'limit' };
    const error = validate(input, now, true);
    if (error) return { ok: false, error };
    const at = new Date(now).toISOString();
    const r: Reminder = {
      ...normalize(input),
      id: createId(),
      enabled: true,
      createdAt: at,
      updatedAt: at,
    };
    commit([...list, r]);
    return { ok: true, value: r };
  },

  update(id: string, input: ReminderInput, now = Date.now()): Result<Reminder> {
    const list = read();
    const existing = list.find(r => r.id === id);
    if (!existing) return { ok: false, error: 'not_found' };
    // Editing a passed one-off into the past again is allowed (it stays past).
    const error = validate(input, now, false);
    if (error) return { ok: false, error };
    const r: Reminder = {
      ...existing,
      ...normalize(input),
      updatedAt: new Date(now).toISOString(),
    };
    commit(list.map(x => (x.id === id ? r : x)));
    return { ok: true, value: r };
  },

  setEnabled(id: string, enabled: boolean) {
    commit(
      read().map(r =>
        r.id === id
          ? { ...r, enabled, updatedAt: new Date().toISOString() }
          : r,
      ),
    );
  },

  remove(id: string) {
    commit(read().filter(r => r.id !== id));
  },

  /** Tests only. */
  resetCacheForTest() {
    cache = null;
  },
};
