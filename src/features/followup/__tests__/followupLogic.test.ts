import { Linking } from 'react-native';
import { storage } from '@/store/mmkv';
import { openDialer, openWhatsApp } from '../services/contactActions';
import { activitiesCsv, contactsCsv } from '../services/export';
import { buildReminders, type ReminderTexts } from '../services/reminders';
import { nextBirthday, statusOf } from '../services/status';
import {
  buildRows,
  EMPTY_FILTERS,
  summarize,
  timelineOf,
} from '../services/views';
import { followUpStore } from '../store/followup.store';
import type { FollowUpActivity } from '../types';
import { formatPhone, parsePhone, telUrl, whatsappUrl } from '../utils/phone';

jest.mock('@/specs/NativeFollowUp', () => ({
  __esModule: true,
  default: null,
}));

const TODAY = '2026-10-28';
const at = (time: string, day = TODAY) => new Date(`${day}T${time}:00`);

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(at('09:00'));
  storage.clearAll();
  followUpStore.resetCacheForTest();
});
afterEach(() => jest.useRealTimers());

function contact(name = 'Asha Rao', phone = '98765 43210', dial = '+91') {
  const r = followUpStore.createContact({ name, phone, dial });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

describe('phone numbers', () => {
  it('normalises with the selected country code, without assuming India', () => {
    expect(parsePhone('(0)7700 900-123', '+44')).toEqual({
      ok: true,
      value: { dial: '+44', phone: '7700900123', e164: '447700900123' },
    });
    expect(parsePhone('415 555 0134', '+1')).toMatchObject({
      ok: true,
      value: { e164: '14155550134' },
    });
    // Italy keeps its leading 0.
    expect(parsePhone('06 1234 5678', '+39')).toMatchObject({
      value: { e164: '390612345678' },
    });
  });

  it('accepts a full international number typed with 00 or +', () => {
    expect(parsePhone('0049 1512 3456789', '+44')).toMatchObject({
      ok: true,
      value: { dial: '', e164: '4915123456789' },
    });
    expect(parsePhone('+49 1512 3456789', '+91')).toMatchObject({
      value: { e164: '4915123456789' },
    });
  });

  it('rejects missing, short, too long or lettered numbers', () => {
    expect(parsePhone('  ', '+91')).toEqual({
      ok: false,
      error: 'phone_required',
    });
    expect(parsePhone('123', '+91')).toEqual({
      ok: false,
      error: 'phone_invalid',
    });
    expect(parsePhone('1234567890123456', '+91')).toEqual({
      ok: false,
      error: 'phone_invalid',
    });
    expect(parsePhone('98765abc10', '+91')).toEqual({
      ok: false,
      error: 'phone_invalid',
    });
    expect(parsePhone('9876543210', '91')).toEqual({
      ok: false,
      error: 'dial_invalid',
    });
  });

  it('builds dialer and wa.me links (digits only, no "+")', () => {
    expect(telUrl('919876543210')).toBe('tel:+919876543210');
    expect(whatsappUrl('919876543210')).toBe('https://wa.me/919876543210');
    expect(whatsappUrl('919876543210', ' Hi & bye ')).toBe(
      'https://wa.me/919876543210?text=Hi%20%26%20bye',
    );
    expect(
      formatPhone({ dial: '+91', phone: '9876543210', e164: '919876543210' }),
    ).toBe('+91 9876 5432 10');
  });
});

describe('contacts', () => {
  it('validates required fields and email', () => {
    expect(
      followUpStore.createContact({
        name: ' ',
        phone: '9876543210',
        dial: '+91',
      }),
    ).toEqual({
      ok: false,
      error: 'name_required',
    });
    expect(
      followUpStore.createContact({ name: 'A', phone: '', dial: '+91' }),
    ).toEqual({
      ok: false,
      error: 'phone_required',
    });
    expect(
      followUpStore.createContact({
        name: 'A',
        phone: '9876543210',
        dial: '+91',
        email: 'nope',
      }),
    ).toEqual({ ok: false, error: 'email_invalid' });
  });

  it('finds duplicates by normalised number and never merges', () => {
    const asha = contact();
    expect(followUpStore.findDuplicate('098765-43210', '+91')?.id).toBe(
      asha.id,
    );
    expect(followUpStore.findDuplicate('9876543210', '+44')).toBeNull();
    expect(
      followUpStore.findDuplicate('9876543210', '+91', asha.id),
    ).toBeNull();
    // Saving anyway creates a second, separate contact.
    contact('Asha (work)');
    expect(followUpStore.read().contacts).toHaveLength(2);
  });

  it('edits, deactivates and deletes with all related records', () => {
    const asha = contact();
    const edited = followUpStore.updateContact(asha.id, {
      name: 'Asha R',
      phone: '9876500000',
      dial: '+91',
      organization: 'Acme',
    });
    expect(edited.ok && edited.value.e164).toBe('919876500000');
    followUpStore.setContactActive(asha.id, false);
    followUpStore.schedule(asha.id, { day: TODAY, type: 'call' });
    followUpStore.addNote({
      contactId: asha.id,
      kind: 'note',
      content: 'Hello',
    });
    expect(followUpStore.deleteContact(asha.id).ok).toBe(true);
    const d = followUpStore.read();
    expect([d.contacts, d.activities, d.notes]).toEqual([[], [], []]);
  });

  it('persists across an app restart', () => {
    const asha = contact();
    followUpStore.schedule(asha.id, {
      day: '2026-10-30',
      time: '10:30',
      type: 'meeting',
    });
    followUpStore.resetCacheForTest();
    const d = followUpStore.read();
    expect(d.contacts[0].name).toBe('Asha Rao');
    expect(d.activities[0]).toMatchObject({
      day: '2026-10-30',
      time: '10:30',
      type: 'meeting',
    });
  });
});

describe('categories and tags', () => {
  it('creates, renames, rejects duplicates, and deletes safely', () => {
    const cat = followUpStore.saveCategory({
      name: 'Client',
      color: 'blue',
      icon: 'tag',
    });
    const tag = followUpStore.saveTag({ name: 'Hot', color: 'rose' });
    if (!cat.ok || !tag.ok) throw new Error('setup');
    expect(
      followUpStore.saveCategory({
        name: ' client ',
        color: 'teal',
        icon: 'tag',
      }),
    ).toEqual({
      ok: false,
      error: 'name_taken',
    });
    const r = followUpStore.createContact({
      name: 'B',
      phone: '9876543210',
      dial: '+91',
      categoryId: cat.value.id,
      tagIds: [tag.value.id, 'unknown'],
    });
    expect(r.ok && r.value.tagIds).toEqual([tag.value.id]);
    followUpStore.saveCategory({
      id: cat.value.id,
      name: 'Customer',
      color: 'blue',
      icon: 'tag',
    });
    expect(followUpStore.read().categories[0].name).toBe('Customer');
    expect(followUpStore.deleteCategory(cat.value.id)).toEqual({
      ok: true,
      value: 1,
    });
    expect(followUpStore.deleteTag(tag.value.id)).toEqual({
      ok: true,
      value: 1,
    });
    expect(followUpStore.read().contacts[0]).toMatchObject({
      categoryId: '',
      tagIds: [],
    });
  });

  it('adds suggestions once', () => {
    const cats = [{ name: 'Client', color: 'blue', icon: 'tag' }];
    expect(
      followUpStore.addSuggestions(cats, [{ name: 'Hot', color: 'rose' }]),
    ).toBe(2);
    expect(
      followUpStore.addSuggestions(cats, [{ name: 'hot', color: 'rose' }]),
    ).toBe(0);
  });
});

describe('follow-ups', () => {
  it('derives Due / Overdue from the date, time and now', () => {
    const base = { completedAt: '', cancelled: false } as FollowUpActivity;
    const a = (day: string, time = '') => ({ ...base, day, time });
    const now = at('09:00');
    expect(statusOf(a(TODAY), now)).toBe('due');
    expect(statusOf(a(TODAY, '10:00'), now)).toBe('due');
    expect(statusOf(a(TODAY, '08:30'), now)).toBe('overdue');
    expect(statusOf(a('2026-10-27'), now)).toBe('overdue');
    expect(statusOf(a('2026-10-29'), now)).toBe('scheduled');
    expect(statusOf({ ...a(TODAY), completedAt: now.toISOString() }, now)).toBe(
      'completed',
    );
    expect(statusOf({ ...a(TODAY), cancelled: true }, now)).toBe('cancelled');
  });

  it('completes without overwriting history and links the next follow-up', () => {
    const asha = contact();
    const first = followUpStore.schedule(asha.id, {
      day: TODAY,
      type: 'call',
      purpose: 'Quote',
    });
    if (!first.ok) throw new Error(first.error);
    const done = followUpStore.complete(first.value.id, {
      outcome: 'call_back',
      note: 'Busy',
      next: { day: '2026-11-02', type: 'whatsapp', purpose: 'Send quote' },
    });
    expect(done.ok).toBe(true);
    const [a, b] = followUpStore.read().activities;
    expect(a).toMatchObject({
      purpose: 'Quote',
      outcome: 'call_back',
      completionNote: 'Busy',
    });
    expect(a.nextActivityId).toBe(b.id);
    expect(b).toMatchObject({
      day: '2026-11-02',
      type: 'whatsapp',
      completedAt: '',
    });
    expect(
      followUpStore.complete(first.value.id, { outcome: 'successful' }),
    ).toEqual({
      ok: false,
      error: 'already_completed',
    });
  });

  it('rejects an accidental double submit and bad dates', () => {
    const asha = contact();
    expect(
      followUpStore.schedule(asha.id, { day: TODAY, type: 'call' }).ok,
    ).toBe(true);
    expect(
      followUpStore.schedule(asha.id, { day: TODAY, type: 'call' }),
    ).toEqual({
      ok: false,
      error: 'duplicate',
    });
    expect(
      followUpStore.schedule(asha.id, { day: '2026-02-30', type: 'call' }),
    ).toEqual({
      ok: false,
      error: 'date_invalid',
    });
    expect(
      followUpStore.schedule(asha.id, {
        day: TODAY,
        time: '25:00',
        type: 'other',
      }),
    ).toEqual({
      ok: false,
      error: 'time_invalid',
    });
  });

  it('keeps reschedules in the timeline', () => {
    const asha = contact();
    const f = followUpStore.schedule(asha.id, { day: TODAY, type: 'call' });
    if (!f.ok) throw new Error(f.error);
    followUpStore.editFollowUp(f.value.id, {
      day: '2026-10-29',
      time: '11:00',
      type: 'call',
    });
    followUpStore.addNote({
      contactId: asha.id,
      kind: 'call',
      content: 'Spoke briefly',
    });
    const kinds = timelineOf(followUpStore.read(), asha.id).map(i =>
      i.kind === 'event' ? i.event.kind : i.kind,
    );
    expect(kinds).toEqual(
      expect.arrayContaining(['scheduled', 'rescheduled', 'note']),
    );
    const moved = timelineOf(followUpStore.read(), asha.id).find(
      i => i.kind === 'event',
    );
    expect(moved?.kind === 'event' && moved.event.detail).toBe(
      '2026-10-28 → 2026-10-29 11:00',
    );
  });
});

describe('dashboard lists', () => {
  it('shows one card per contact and counts real data', () => {
    const asha = contact();
    const ravi = contact('Ravi', '9123456780');
    contact('Meera', '9000000001');
    followUpStore.schedule(asha.id, { day: '2026-10-26', type: 'call' });
    followUpStore.schedule(asha.id, {
      day: TODAY,
      time: '08:00',
      type: 'call',
    });
    followUpStore.schedule(asha.id, {
      day: TODAY,
      time: '17:00',
      type: 'meeting',
    });
    const r = followUpStore.schedule(ravi.id, {
      day: '2026-11-05',
      type: 'whatsapp',
    });
    const d = followUpStore.read();
    const now = at('09:00');
    const ids = (view: Parameters<typeof buildRows>[1]) =>
      buildRows(d, view, EMPTY_FILTERS, 'dueSoonest', now).map(
        x => x.contact.name,
      );
    expect(ids('pending')).toEqual(['Asha Rao']);
    expect(ids('overdue')).toEqual(['Asha Rao']);
    expect(ids('today')).toEqual(['Asha Rao']);
    expect(ids('upcoming')).toEqual(['Ravi']);
    expect(ids('all')).toHaveLength(3);
    const pending = buildRows(
      d,
      'pending',
      EMPTY_FILTERS,
      'dueSoonest',
      now,
    )[0];
    expect(pending.activity?.day).toBe('2026-10-26');
    expect(pending.more).toBe(2);
    if (r.ok) followUpStore.complete(r.value.id, { outcome: 'message_sent' });
    expect(summarize(followUpStore.read(), now)).toEqual({
      contacts: 3,
      dueToday: 1,
      overdue: 2,
      doneToday: 1,
      upcoming: 0,
    });
    expect(
      buildRows(
        followUpStore.read(),
        'done',
        EMPTY_FILTERS,
        'dueSoonest',
        now,
      ).map(x => x.contact.name),
    ).toEqual(['Ravi']);
  });

  it('searches by name or number and filters by tag and date', () => {
    const tag = followUpStore.saveTag({ name: 'Hot', color: 'rose' });
    if (!tag.ok) throw new Error('tag');
    const asha = contact();
    followUpStore.updateContact(asha.id, {
      name: 'Asha Rao',
      phone: '9876543210',
      dial: '+91',
      tagIds: [tag.value.id],
    });
    contact('Ravi', '9123456780');
    const d = followUpStore.read();
    const now = at('09:00');
    const names = (f: Partial<typeof EMPTY_FILTERS>) =>
      buildRows(d, 'all', { ...EMPTY_FILTERS, ...f }, 'name', now).map(
        x => x.contact.name,
      );
    expect(names({ query: 'ravi' })).toEqual(['Ravi']);
    expect(names({ query: '43210' })).toEqual(['Asha Rao']);
    expect(names({ tagId: tag.value.id })).toEqual(['Asha Rao']);
    expect(names({ from: '2026-11-01' })).toEqual([]);
  });
});

describe('reminders', () => {
  const texts: ReminderTexts = {
    due: c => ({ title: `Due ${c.name}`, body: '' }),
    overdue: c => ({ title: `Late ${c.name}`, body: '' }),
    birthday: c => ({ title: `Bday ${c.name}`, body: '' }),
  };

  it('follows the data: lead time, overdue nudge, birthdays; drops done ones', () => {
    const asha = contact();
    followUpStore.updateSettings({
      remindersEnabled: true,
      leadMinutes: 15,
      birthdayReminders: true,
    });
    followUpStore.updateContact(asha.id, {
      name: 'Asha Rao',
      phone: '9876543210',
      dial: '+91',
      birthDate: '1990-10-30',
    });
    const f = followUpStore.schedule(asha.id, {
      day: TODAY,
      time: '11:00',
      type: 'call',
      reminder: true,
    });
    followUpStore.schedule(asha.id, {
      day: TODAY,
      time: '12:00',
      type: 'call',
      reminder: false,
    });
    const list = buildReminders(followUpStore.read(), at('09:00'), texts);
    expect(
      list.map(r => [r.key.split(':')[0], new Date(r.at).toISOString()]),
    ).toEqual([
      ['due', at('10:45').toISOString()],
      ['over', at('10:00', '2026-10-29').toISOString()],
      ['bday', at('10:00', '2026-10-30').toISOString()],
    ]);
    if (f.ok) followUpStore.complete(f.value.id, { outcome: 'successful' });
    expect(
      buildReminders(followUpStore.read(), at('09:00'), texts).map(r => r.key),
    ).toEqual([`bday:${asha.id}`]);
    followUpStore.updateSettings({
      remindersEnabled: false,
      birthdayReminders: false,
    });
    expect(buildReminders(followUpStore.read(), at('09:00'), texts)).toEqual(
      [],
    );
  });

  it('handles 29 February birthdays', () => {
    expect(nextBirthday('2000-02-29', '2027-01-10')).toBe('2027-02-28');
    expect(nextBirthday('2000-02-29', '2028-01-10')).toBe('2028-02-29');
  });
});

describe('call and WhatsApp', () => {
  it('opens the dialer and wa.me with the normalised number', async () => {
    const asha = contact();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    expect(await openDialer(asha)).toBe('opened');
    expect(await openWhatsApp(asha, 'Hi')).toBe('opened');
    expect(open.mock.calls.map(c => c[0])).toEqual([
      'tel:+919876543210',
      'https://wa.me/919876543210?text=Hi',
    ]);
    const kinds = followUpStore.read().events.map(e => e.kind);
    expect(kinds).toEqual(['dialer_opened', 'whatsapp_opened']);
  });

  it('reports when no app can open the link', async () => {
    const asha = contact();
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('No activity'));
    expect(await openWhatsApp(asha)).toBe('unavailable');
    expect(followUpStore.read().events).toEqual([]);
  });
});

describe('export', () => {
  it('quotes CSV safely and neutralises formulas', () => {
    const asha = contact('=HYPERLINK("x"), Inc');
    followUpStore.schedule(asha.id, {
      day: TODAY,
      type: 'call',
      purpose: 'Line1\nLine2',
    });
    const csv = contactsCsv(followUpStore.read());
    expect(csv.split('\r\n')[1]).toContain('"\'=HYPERLINK(""x""), Inc"');
    expect(activitiesCsv(followUpStore.read())).toContain('"Line1\nLine2"');
  });
});
