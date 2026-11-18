import {
  cleanAlert,
  DEFAULT_ALERT,
  firstOccurrence,
  nextOccurrence,
  occurrencesBetween,
} from '..';

/** Local wall-clock instant (the test runner's zone). */
const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime();

const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
};

// Same cases as android/.../alarms/AlarmMathTest.kt, so both sides agree.
describe('nextOccurrence', () => {
  it('rings a one-off once, then never', () => {
    const now = at(2026, 11, 18, 10);
    expect(local(nextOccurrence('2026-11-20', '09:30', 'never', now)!)).toBe(
      '2026-11-20 09:30',
    );
    expect(nextOccurrence('2026-11-17', '09:30', 'never', now)).toBeNull();
  });

  it('moves daily and weekly reminders to the next one after now', () => {
    const now = at(2026, 11, 18, 10);
    expect(local(nextOccurrence('2026-01-01', '09:00', 'daily', now)!)).toBe(
      '2026-11-19 09:00',
    );
    expect(local(nextOccurrence('2026-01-01', '11:00', 'daily', now)!)).toBe(
      '2026-11-18 11:00',
    );
    expect(local(nextOccurrence('2026-11-02', '08:00', 'weekly', now)!)).toBe(
      '2026-11-23 08:00',
    );
  });

  it('keeps the day of month and clamps short months', () => {
    expect(
      local(nextOccurrence('2027-01-31', '07:00', 'monthly', at(2027, 2, 1))!),
    ).toBe('2027-02-28 07:00');
    expect(
      local(nextOccurrence('2027-01-31', '07:00', 'monthly', at(2027, 3, 1))!),
    ).toBe('2027-03-31 07:00');
  });

  it('handles yearly birthdays, including 29 February', () => {
    const now = at(2026, 11, 18);
    expect(local(nextOccurrence('1990-05-04', '08:00', 'yearly', now)!)).toBe(
      '2027-05-04 08:00',
    );
    expect(local(nextOccurrence('2000-02-29', '08:00', 'yearly', now)!)).toBe(
      '2027-02-28 08:00',
    );
    expect(
      local(nextOccurrence('2000-02-29', '08:00', 'yearly', at(2028, 1, 1))!),
    ).toBe('2028-02-29 08:00');
  });

  it('rejects bad input', () => {
    expect(nextOccurrence('2026-13-01', '09:00', 'daily', 0)).toBeNull();
    expect(nextOccurrence('2026-11-01', '24:00', 'daily', 0)).toBeNull();
    expect(firstOccurrence('nope', '09:00')).toBeNull();
  });
});

describe('occurrencesBetween', () => {
  it('lists every occurrence in a range, for calendar dots', () => {
    const from = at(2026, 11, 1);
    const to = at(2026, 11, 30, 23, 59);
    expect(
      occurrencesBetween('2026-10-05', '09:00', 'weekly', from, to).map(local),
    ).toEqual([
      '2026-11-02 09:00',
      '2026-11-09 09:00',
      '2026-11-16 09:00',
      '2026-11-23 09:00',
      '2026-11-30 09:00',
    ]);
    expect(
      occurrencesBetween('2026-11-05', '09:00', 'never', from, to),
    ).toHaveLength(1);
    expect(
      occurrencesBetween('2026-12-05', '09:00', 'daily', from, to),
    ).toHaveLength(0);
  });
});

describe('cleanAlert', () => {
  it('fills defaults and rejects unsafe or out-of-range values', () => {
    expect(cleanAlert(null)).toEqual(DEFAULT_ALERT);
    expect(
      cleanAlert({
        mode: 'nuclear',
        ringtone: 'file:///sdcard/x.mp3',
        ringtoneTitle: 'X',
        volume: 900,
        vibration: 'buzz',
        snoozeMinutes: -3,
      }),
    ).toEqual({ ...DEFAULT_ALERT, volume: 100, snoozeMinutes: 0 });
    expect(
      cleanAlert({ ringtone: 'content://media/9', ringtoneTitle: 'Chime' }),
    ).toMatchObject({ ringtone: 'content://media/9', ringtoneTitle: 'Chime' });
  });
});
