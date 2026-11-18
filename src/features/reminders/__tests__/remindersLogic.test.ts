import { DEFAULT_ALERT } from '@/services/alarms';
import { storage } from '@/store/mmkv';
import {
  alarmEntries,
  monthDots,
  onDay,
  validate,
  views,
} from '../services/reminders';
import { remindersStore } from '../store/reminders.store';
import type { Reminder, ReminderInput } from '../types';

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 18, 10);

const input = (i: Partial<ReminderInput> = {}): ReminderInput => ({
  title: 'Dentist',
  description: '',
  date: '2026-11-20',
  time: '09:30',
  category: 'personal',
  customLabel: '',
  repeat: 'never',
  alert: DEFAULT_ALERT,
  ...i,
});

let n = 0;
const reminder = (r: Partial<Reminder> = {}): Reminder => ({
  ...input(),
  id: `r${n++}`,
  enabled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...r,
});

beforeEach(() => {
  storage.clearAll();
  remindersStore.resetCacheForTest();
});

describe('validate', () => {
  it('needs a title, a date and a valid time', () => {
    expect(validate(input({ title: ' ' }), NOW, true)).toBe('title_required');
    expect(validate(input({ date: '20-11-2026' }), NOW, true)).toBe(
      'date_invalid',
    );
    expect(validate(input({ time: '9:5' }), NOW, true)).toBe('time_invalid');
    expect(validate(input(), NOW, true)).toBeNull();
  });

  it('refuses a new one-off in the past, but allows a repeating one', () => {
    const past = input({ date: '2026-11-17' });
    expect(validate(past, NOW, true)).toBe('in_past');
    expect(validate({ ...past, repeat: 'yearly' }, NOW, true)).toBeNull();
    // Editing an existing past reminder is allowed.
    expect(validate(past, NOW, false)).toBeNull();
  });
});

describe('views', () => {
  it('splits upcoming (soonest first), past and off', () => {
    const soon = reminder({ title: 'Soon', date: '2026-11-18', time: '12:00' });
    const later = reminder({ title: 'Later', date: '2026-12-01' });
    const passed = reminder({ title: 'Passed', date: '2026-11-10' });
    const birthday = reminder({
      title: 'Mum',
      category: 'birthday',
      date: '1960-05-04',
      time: '08:00',
      repeat: 'yearly',
    });
    const off = reminder({ title: 'Off', date: '2026-12-24', enabled: false });
    const v = views([later, passed, birthday, soon, off], NOW);
    expect(v.upcoming.map(x => x.reminder.title)).toEqual([
      'Soon',
      'Later',
      'Mum',
    ]);
    expect(v.upcoming[2].at).toBe(at(2027, 5, 4, 8));
    expect(v.past.map(x => x.reminder.title)).toEqual(['Passed']);
    expect(v.off.map(r => r.title)).toEqual(['Off']);
  });
});

describe('calendar', () => {
  it("lists a day's reminders, including repeating ones", () => {
    const weekly = reminder({
      title: 'Team call',
      category: 'meeting',
      date: '2026-11-02',
      time: '11:00',
      repeat: 'weekly',
    });
    const once = reminder({
      title: 'Dentist',
      date: '2026-11-16',
      time: '09:00',
    });
    expect(
      onDay([weekly, once], '2026-11-16').map(x => x.reminder.title),
    ).toEqual(['Dentist', 'Team call']);
    expect(onDay([weekly, once], '2026-11-17')).toEqual([]);
  });

  it('marks days with category colours, birthdays first', () => {
    const color = (k: string) => k;
    const dots = monthDots(
      [
        reminder({ category: 'meeting', date: '2026-11-05' }),
        reminder({
          category: 'birthday',
          date: '1990-11-05',
          repeat: 'yearly',
        }),
        reminder({ category: 'important', date: '2026-11-20' }),
      ],
      '2026-11-01',
      30,
      color,
    );
    expect(dots['2026-11-05']).toEqual(['rose', 'teal']);
    expect(dots['2026-11-20']).toEqual(['amber']);
    expect(dots['2026-11-06']).toBeUndefined();
  });
});

describe('alarm entries', () => {
  it('schedules only enabled reminders with an occurrence ahead, as wall-clock times', () => {
    const on = reminder({ id: 'a', repeat: 'daily', date: '2026-01-01' });
    const off = reminder({ id: 'b', enabled: false });
    const passed = reminder({ id: 'c', date: '2026-11-01' });
    const entries = alarmEntries([on, off, passed], NOW, r => r.title);
    expect(entries).toEqual([
      expect.objectContaining({
        key: 'reminder:a',
        at: 0,
        date: '2026-01-01',
        time: '09:30',
        repeat: 'daily',
        link: 'rnboilerplate://reminders',
      }),
    ]);
  });
});

describe('store', () => {
  it('creates, edits, switches off and deletes reminders', () => {
    const created = remindersStore.create(input({ title: '  Dentist ' }), NOW);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({ title: 'Dentist', enabled: true });
    const updated = remindersStore.update(
      created.value.id,
      input({ title: 'Dentist (moved)', time: '15:00' }),
      NOW,
    );
    expect(updated.ok && updated.value.time).toBe('15:00');
    remindersStore.setEnabled(created.value.id, false);
    expect(remindersStore.read()[0].enabled).toBe(false);
    remindersStore.remove(created.value.id);
    expect(remindersStore.read()).toEqual([]);
  });

  it('drops bad records on load', () => {
    storage.set(
      'reminders.items',
      JSON.stringify([
        {
          id: 'x',
          title: 'Ok',
          date: '2026-11-20',
          time: '09:00',
          repeat: 'hourly',
        },
        { id: 'y', title: '', date: '2026-11-20', time: '09:00' },
        'junk',
      ]),
    );
    remindersStore.resetCacheForTest();
    const list = remindersStore.read();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ repeat: 'never', category: 'personal' });
  });
});
