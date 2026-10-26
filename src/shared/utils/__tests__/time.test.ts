import { formatClock, formatDuration, formatTimestamp } from '../time';

describe('formatDuration', () => {
  it('formats under a minute', () => {
    expect(formatDuration(7)).toBe('0:07');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(95)).toBe('1:35');
  });

  it('adds an hours field only once past an hour', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('clamps negatives rather than rendering a nonsense clock', () => {
    expect(formatDuration(-5)).toBe('0:00');
  });
});

describe('formatTimestamp', () => {
  it('renders a fixed-width, locale-independent stamp', () => {
    // Constructed in local time so the assertion holds in any timezone —
    // the burned timestamp is deliberately device-local.
    const date = new Date(2026, 0, 5, 9, 7, 3);
    expect(formatTimestamp(date.getTime())).toBe('2026-01-05 09:07:03');
  });
});

describe('formatClock', () => {
  it('always pads to HH:MM:SS', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(9)).toBe('00:00:09');
    expect(formatClock(75)).toBe('00:01:15');
  });

  it('carries into the hour field', () => {
    expect(formatClock(3600)).toBe('01:00:00');
    expect(formatClock(3661)).toBe('01:01:01');
    expect(formatClock(36000)).toBe('10:00:00');
  });

  it('floors fractions and clamps negatives', () => {
    expect(formatClock(1.9)).toBe('00:00:01');
    expect(formatClock(-5)).toBe('00:00:00');
  });
});
