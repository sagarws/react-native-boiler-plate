import {
  IDLE_STOPWATCH,
  extendTimer,
  formatClock,
  idleTimer,
  lapRows,
  lapStopwatch,
  pauseStopwatch,
  pauseTimer,
  resetTimer,
  startStopwatch,
  startTimer,
  stopwatchElapsed,
  timerPhase,
  timerRemaining,
  toMs,
} from '../services/clock';
import {
  convert,
  formatNumber,
  parseNumber,
  unitsOf,
  CONVERT_CATEGORIES,
} from '../services/convert';
import { bubbleOffset, levelReading, rawAngles } from '../services/level';
import { headingDelta, solveTrig, type Sight } from '../services/trig';
import { fromMeters, toMeters } from '../services/units';

const sight = (elevation: number, azimuth: number | null = null): Sight => ({
  elevation,
  azimuth,
});
/** Elevation angle (degrees) of a point [rise] above the eye, [run] away. */
const angleTo = (rise: number, run: number) =>
  (Math.atan2(rise, run) * 180) / Math.PI;

describe('stopwatch', () => {
  it('counts from a start time, pauses, resumes and laps', () => {
    let s = startStopwatch(IDLE_STOPWATCH, 1000);
    expect(stopwatchElapsed(s, 3500)).toBe(2500);
    s = lapStopwatch(s, 2000); // lap 1 at 1.0 s
    s = pauseStopwatch(s, 4000); // 3.0 s banked
    expect(stopwatchElapsed(s, 99_999)).toBe(3000); // paused: no change
    expect(lapStopwatch(s, 5000)).toBe(s); // no laps while paused
    s = startStopwatch(s, 10_000);
    s = lapStopwatch(s, 10_500); // lap 2 at 3.5 s
    s = lapStopwatch(s, 12_500); // lap 3 at 5.5 s
    expect(stopwatchElapsed(s, 13_000)).toBe(6000);
    const rows = lapRows(s.laps);
    expect(rows.map(r => [r.index, r.splitMs, r.totalMs])).toEqual([
      [3, 2000, 5500],
      [2, 2500, 3500],
      [1, 1000, 1000],
    ]);
    expect(rows.find(r => r.fastest)?.index).toBe(1);
    expect(rows.find(r => r.slowest)?.index).toBe(2);
  });

  it('keeps the right time after the app was closed (timestamp based)', () => {
    const s = startStopwatch(IDLE_STOPWATCH, 0);
    expect(stopwatchElapsed(s, 3_600_000)).toBe(3_600_000);
  });

  it('formats with hundredths, and hours when needed', () => {
    expect(formatClock(0, true)).toBe('00:00.00');
    expect(formatClock(62_345, true)).toBe('01:02.34');
    expect(formatClock(3_723_450, true)).toBe('1:02:03.45');
  });
});

describe('countdown timer', () => {
  it('runs, pauses, resumes and finishes from stored timestamps', () => {
    let t = idleTimer(60_000);
    expect(timerPhase(t, 0)).toBe('idle');
    t = startTimer(t, 1000);
    expect(t.endsAt).toBe(61_000);
    expect(timerPhase(t, 30_000)).toBe('running');
    expect(timerRemaining(t, 31_000)).toBe(30_000);
    t = pauseTimer(t, 31_000);
    expect(timerPhase(t, 999_999)).toBe('paused');
    expect(timerRemaining(t, 999_999)).toBe(30_000);
    t = startTimer(t, 100_000);
    expect(t.endsAt).toBe(130_000);
    expect(timerPhase(t, 130_000)).toBe('finished');
    expect(timerRemaining(t, 200_000)).toBe(0);
    t = resetTimer(t);
    expect(t).toEqual(idleTimer(60_000));
  });

  it('adds a minute to a running or finished timer', () => {
    const running = startTimer(idleTimer(60_000), 0);
    expect(extendTimer(running, 60_000, 30_000).endsAt).toBe(120_000);
    const finished = startTimer(idleTimer(10_000), 0);
    const again = extendTimer(finished, 60_000, 50_000);
    expect(again.endsAt).toBe(110_000);
    expect(timerPhase(again, 60_000)).toBe('running');
  });

  it('builds and formats durations, never showing 00:00 while time is left', () => {
    expect(toMs(1, 2, 3)).toBe(3_723_000);
    expect(toMs(0, 0, 0)).toBe(0);
    expect(formatClock(300_000, false)).toBe('05:00');
    expect(formatClock(400, false)).toBe('00:01');
    expect(formatClock(3_600_000, false)).toBe('1:00:00');
  });

  it('does not start a zero-length timer', () => {
    const t = idleTimer(0);
    expect(startTimer(t, 5)).toBe(t);
    expect(timerPhase(t, 5)).toBe('finished');
  });
});

describe('angle (trigonometric) measuring', () => {
  it('height from a known distance: H = D (tan top − tan base)', () => {
    // A 6 m pole 10 m away, eye at 1.5 m.
    const r = solveTrig('heightFromDistance', 10, [
      sight(angleTo(-1.5, 10)),
      sight(angleTo(4.5, 10)),
    ]);
    expect(r.ok && r.meters).toBeCloseTo(6, 6);
    expect(r.ok && r.uncertainty).toBeGreaterThan(0);
  });

  it('height from the phone height: distance from the base angle first', () => {
    // Phone 1.5 m up, a 6 m pole 10 m away.
    const r = solveTrig('heightFromDeviceHeight', 1.5, [
      sight(angleTo(-1.5, 10)),
      sight(angleTo(4.5, 10)),
    ]);
    expect(r.ok && r.meters).toBeCloseTo(6, 6);
    expect(r.ok && r.distances[0]).toBeCloseTo(10, 6);
  });

  it('floor distance from the phone height', () => {
    const r = solveTrig('distanceFromDeviceHeight', 1.2, [
      sight(angleTo(-1.2, 3)),
    ]);
    expect(r.ok && r.meters).toBeCloseTo(3, 6);
    expect(r.ok && r.lowAngle).toBe(false);
  });

  it('floor length with the law of cosines', () => {
    // Points 3 m and 4 m away, 90° apart → 5 m.
    const r = solveTrig('floorLength', 1.5, [
      sight(angleTo(-1.5, 3), 10),
      sight(angleTo(-1.5, 4), 100),
    ]);
    expect(r.ok && r.meters).toBeCloseTo(5, 6);
    expect(r.ok && r.assumedInLine).toBe(false);
  });

  it('floor length in line when there is no heading', () => {
    const r = solveTrig('floorLength', 1.5, [
      sight(angleTo(-1.5, 2)),
      sight(angleTo(-1.5, 5)),
    ]);
    expect(r.ok && r.meters).toBeCloseTo(3, 6);
    expect(r.ok && r.assumedInLine).toBe(true);
  });

  it('flags low angles and grows the ± for far points', () => {
    const near = solveTrig('distanceFromDeviceHeight', 1.5, [sight(-45)]);
    const far = solveTrig('distanceFromDeviceHeight', 1.5, [sight(-3)]);
    expect(far.ok && far.lowAngle).toBe(true);
    expect(near.ok && far.ok && far.uncertainty > near.uncertainty * 10).toBe(
      true,
    );
  });

  it('rejects impossible input', () => {
    expect(solveTrig('heightFromDistance', 0, [sight(0), sight(10)])).toEqual({
      ok: false,
      error: 'known_invalid',
    });
    expect(solveTrig('heightFromDistance', 5, [sight(10), sight(5)])).toEqual({
      ok: false,
      error: 'top_below_base',
    });
    expect(solveTrig('distanceFromDeviceHeight', 1.5, [sight(2)])).toEqual({
      ok: false,
      error: 'not_below_horizon',
    });
    expect(solveTrig('heightFromDistance', 5, [sight(0), sight(88)])).toEqual({
      ok: false,
      error: 'too_steep',
    });
    expect(solveTrig('floorLength', 1.5, [sight(-20)])).toEqual({
      ok: false,
      error: 'angles_missing',
    });
  });

  it('takes the short way round between headings', () => {
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(10, 350)).toBe(-20);
  });

  it('converts the typed length to metres and back', () => {
    expect(toMeters(150, 'cm')).toBeCloseTo(1.5);
    expect(toMeters(5, 'ft')).toBeCloseTo(1.524);
    expect(fromMeters(1.524, 'ft')).toBe(5);
  });
});

describe('bubble level', () => {
  it('reads flat and level when gravity is straight through the screen', () => {
    expect(levelReading({ x: 0, y: 0, z: 1 })).toEqual({
      mode: 'flat',
      x: 0,
      y: 0,
      level: true,
    });
  });

  it('shows the higher side and floats the bubble towards it', () => {
    // Right side 5° higher.
    const r = Math.sin((5 * Math.PI) / 180);
    const reading = levelReading({
      x: r,
      y: 0,
      z: Math.cos((5 * Math.PI) / 180),
    });
    expect(reading).toMatchObject({ mode: 'flat', x: 5, level: false });
    expect(bubbleOffset(5, 0, 100).dx).toBeGreaterThan(0);
    // Top edge higher: bubble moves up the screen (negative y).
    expect(bubbleOffset(0, 5, 100).dy).toBeLessThan(0);
    // Stops at the rim.
    const rim = bubbleOffset(40, 40, 100);
    expect(Math.hypot(rim.dx, rim.dy)).toBeCloseTo(100);
  });

  it('reads an edge angle off the nearest level or plumb line', () => {
    const a = (3 * Math.PI) / 180;
    // Upright, rotated 3° clockwise.
    expect(levelReading({ x: -Math.sin(a), y: Math.cos(a), z: 0 })).toEqual({
      mode: 'edge',
      angle: 3,
      level: false,
    });
    // On its long side (landscape), level.
    expect(levelReading({ x: 1, y: 0, z: 0 })).toMatchObject({
      mode: 'edge',
      angle: 0,
      level: true,
    });
  });

  it('applies a calibration taken on a slightly sloped surface', () => {
    const g = { x: 0.02, y: -0.01, z: 1 };
    expect(levelReading(g, rawAngles(g))).toMatchObject({
      x: 0,
      y: 0,
      level: true,
    });
  });

  it('ignores an empty reading', () => {
    expect(levelReading({ x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('unit converter', () => {
  it.each([
    ['length', 1, 'mi', 'km', 1.609344],
    ['length', 12, 'in', 'ft', 1],
    ['area', 1, 'acre', 'm2', 4046.8564224],
    ['area', 9, 'ft2', 'yd2', 1],
    ['mass', 1, 'kg', 'lb', 2.2046226218],
    ['volume', 1, 'gal', 'l', 3.785411784],
    ['speed', 36, 'kmh', 'mps', 10],
    ['data', 1, 'GB', 'MB', 1024],
    ['temperature', 100, 'C', 'F', 212],
    ['temperature', 32, 'F', 'C', 0],
    ['temperature', 0, 'K', 'C', -273.15],
  ] as const)('%s: %s %s → %s', (cat, v, from, to, expected) => {
    expect(convert(cat, v, from, to)).toBeCloseTo(expected, 6);
  });

  it('round-trips every unit in every category', () => {
    for (const cat of CONVERT_CATEGORIES) {
      const units = unitsOf(cat);
      for (const a of units)
        for (const b of units)
          expect(convert(cat, convert(cat, 37.5, a, b), b, a)).toBeCloseTo(
            37.5,
            6,
          );
    }
  });

  it('rejects unknown units, bad numbers and below absolute zero', () => {
    expect(convert('length', 1, 'm', 'kg')).toBeNaN();
    expect(convert('temperature', -500, 'C', 'F')).toBeNaN();
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('2e3')).toBe(2000);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
  });

  it('formats without float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(NaN)).toBe('–');
    expect(formatNumber(1e-9)).toBe('1.0000e-9');
  });
});
