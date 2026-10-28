import {
  currentState,
  describeTarget,
  evaluate,
  nextPeriodStart,
  pendingReviews,
  periodContaining,
  periodsBetween,
  streak,
  targetOn,
} from '../services/periods';
import type {
  ProgressReport,
  PeriodReview,
  Task,
  TargetVersion,
} from '../types';
import {
  addDays,
  diffDays,
  formatDuration,
  mondayOf,
  periodCloses,
} from '../utils/dates';

const target = (t: Partial<TargetVersion> = {}): TargetVersion => ({
  effectiveFrom: '2026-10-01',
  quantity: 30,
  frequency: 'daily',
  intervalDays: 1,
  ...t,
});

const task = (t: Partial<Task> = {}): Task => ({
  id: 't1',
  projectId: 'p1',
  name: 'Read',
  description: '',
  icon: 'bookOpen',
  imageUri: '',
  color: 'violet',
  unit: 'minutes',
  targets: [target()],
  startDate: '2026-10-01',
  endDate: null,
  priority: 'medium',
  status: 'active',
  focusDay: null,
  pauses: [],
  notes: '',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  ...t,
});

let n = 0;
const report = (
  day: string,
  quantity: number,
  taskId = 't1',
): ProgressReport => ({
  id: `r${++n}`,
  taskId,
  day,
  quantity,
  note: '',
  reportedAt: `${day}T10:00:00.000Z`,
  createdAt: `${day}T10:00:00.000Z`,
  updatedAt: `${day}T10:00:00.000Z`,
  edits: [],
});

const review = (periodStart: string, periodEnd: string): PeriodReview => ({
  id: `v${++n}`,
  taskId: 't1',
  periodStart,
  periodEnd,
  targetQuantity: 30,
  completedQuantity: 0,
  reason: 'low_energy',
  note: '',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
});

describe('calendar days', () => {
  it('moves across months, years and DST without drift', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // EU DST weekend
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31);
    expect(mondayOf('2026-10-28')).toBe('2026-10-26'); // Wednesday → Monday
    expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sunday → previous Monday
  });

  it('closes a period at local midnight after its last day', () => {
    const closes = periodCloses('2026-10-28');
    expect([
      closes.getFullYear(),
      closes.getMonth(),
      closes.getDate(),
      closes.getHours(),
    ]).toEqual([2026, 9, 29, 0]);
    expect(formatDuration((3 * 60 + 20) * 60_000)).toBe('3h 20m');
    expect(formatDuration(-5)).toBe('0m');
  });
});

describe('period boundaries', () => {
  it('daily: one day', () => {
    expect(periodContaining(task(), '2026-10-28')).toMatchObject({
      start: '2026-10-28',
      end: '2026-10-28',
    });
  });

  it('weekly: Monday–Sunday, with a partial first week', () => {
    const weekly = task({
      startDate: '2026-10-01',
      targets: [target({ frequency: 'weekly', intervalDays: 7, quantity: 5 })],
    });
    // Oct 1 2026 is a Thursday: first period Thu–Sun.
    expect(periodContaining(weekly, '2026-10-02')).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-04',
    });
    expect(periodContaining(weekly, '2026-10-28')).toMatchObject({
      start: '2026-10-26',
      end: '2026-11-01',
    });
  });

  it('every N days counts from the start date', () => {
    const every2 = task({
      targets: [
        target({ frequency: 'interval', intervalDays: 2, quantity: 10 }),
      ],
    });
    expect(periodContaining(every2, '2026-10-01')).toMatchObject({
      start: '2026-10-01',
      end: '2026-10-02',
    });
    expect(periodContaining(every2, '2026-10-04')).toMatchObject({
      start: '2026-10-03',
      end: '2026-10-04',
    });
    const every14 = task({
      targets: [
        target({ frequency: 'interval', intervalDays: 14, quantity: 3 }),
      ],
    });
    expect(periodContaining(every14, '2026-10-20')).toMatchObject({
      start: '2026-10-15',
      end: '2026-10-28',
    });
  });

  it('respects start and end dates', () => {
    const t = task({
      endDate: '2026-10-10',
      targets: [target({ frequency: 'weekly', intervalDays: 7 })],
    });
    expect(periodContaining(t, '2026-09-30')).toBeNull();
    expect(periodContaining(t, '2026-10-11')).toBeNull();
    expect(periodContaining(t, '2026-10-09')).toMatchObject({
      start: '2026-10-05',
      end: '2026-10-10',
    });
  });

  it('lists consecutive periods without gaps', () => {
    const every3 = task({
      targets: [target({ frequency: 'interval', intervalDays: 3 })],
    });
    const ps = periodsBetween(every3, '2026-10-01', '2026-10-09');
    expect(ps.map(p => `${p.start}..${p.end}`)).toEqual([
      '2026-10-01..2026-10-03',
      '2026-10-04..2026-10-06',
      '2026-10-07..2026-10-09',
    ]);
  });
});

describe('target changes keep history', () => {
  it('applies a new target from the next period; old periods keep theirs', () => {
    const t = task();
    expect(nextPeriodStart(t, '2026-10-20')).toBe('2026-10-21');
    const edited = task({
      targets: [
        target(),
        target({ effectiveFrom: '2026-10-21', quantity: 20 }),
      ],
    });
    expect(targetOn(edited, '2026-10-20')!.quantity).toBe(30);
    expect(targetOn(edited, '2026-10-21')!.quantity).toBe(20);
    expect(periodContaining(edited, '2026-10-15')!.target.quantity).toBe(30);
  });

  it('a weekly → daily change waits for the current week to end', () => {
    const weekly = task({
      targets: [target({ frequency: 'weekly', intervalDays: 7 })],
    });
    expect(nextPeriodStart(weekly, '2026-10-28')).toBe('2026-11-02');
  });
});

describe('progress within a period', () => {
  const today = '2026-10-28';

  it('accumulates several reports (partial, exact, exceeded)', () => {
    const t = task();
    const p = periodContaining(t, today)!;
    const partial = evaluate(t, p, {
      reports: [report(today, 20)],
      reviews: [],
      today,
    });
    expect(partial).toMatchObject({
      status: 'active',
      completed: 20,
      remaining: 10,
      percent: 67,
      met: false,
    });
    const exact = evaluate(t, p, {
      reports: [report(today, 20), report(today, 10)],
      reviews: [],
      today,
    });
    expect(exact).toMatchObject({
      completed: 30,
      remaining: 0,
      percent: 100,
      met: true,
      exceeded: false,
    });
    const over = evaluate(t, p, {
      reports: [report(today, 45)],
      reviews: [],
      today,
    });
    expect(over).toMatchObject({ completed: 45, percent: 100, exceeded: true });
    expect(over.ratio).toBeCloseTo(1.5);
  });

  it('weekly progress sums the whole week', () => {
    const t = task({
      targets: [
        target({ frequency: 'weekly', intervalDays: 7, quantity: 300 }),
      ],
    });
    const s = currentState(t, {
      reports: [
        report('2026-10-26', 100),
        report('2026-10-27', 60),
        report('2026-10-20', 999),
      ],
      reviews: [],
      today,
    })!;
    expect(s).toMatchObject({
      start: '2026-10-26',
      end: '2026-11-01',
      completed: 160,
      remaining: 140,
    });
  });
});

describe('period-end status', () => {
  const today = '2026-10-28';

  it('an unmet ended period requires a reason; a review resolves it; a met one is achieved', () => {
    const t = task();
    const p = periodContaining(t, '2026-10-27')!;
    expect(
      evaluate(t, p, {
        reports: [report('2026-10-27', 10)],
        reviews: [],
        today,
      }).status,
    ).toBe('report_required');
    expect(
      evaluate(t, p, {
        reports: [],
        reviews: [review('2026-10-27', '2026-10-27')],
        today,
      }).status,
    ).toBe('missed');
    expect(
      evaluate(t, p, {
        reports: [report('2026-10-27', 30)],
        reviews: [],
        today,
      }).status,
    ).toBe('achieved');
  });

  it('no reports is not the same as zero progress', () => {
    const t = task();
    const p = periodContaining(t, '2026-10-27')!;
    const s = evaluate(t, p, { reports: [], reviews: [], today });
    expect(s).toMatchObject({
      status: 'report_required',
      hasReports: false,
      completed: 0,
    });
  });

  it('paused periods never ask for a reason', () => {
    const t = task({
      pauses: [{ from: '2026-10-25', to: '2026-10-27', reason: 'Travel' }],
    });
    expect(
      evaluate(t, periodContaining(t, '2026-10-26')!, {
        reports: [],
        reviews: [],
        today,
      }).status,
    ).toBe('paused');
    const pending = pendingReviews(
      t,
      { reports: [], reviews: [], today },
      '2026-10-24',
    );
    expect(pending.map(s => s.start)).toEqual(['2026-10-24']);
  });

  it('does not ask about time before the task was created (missed periods since are listed)', () => {
    const t = task({
      startDate: '2026-10-01',
      createdAt: '2026-10-26T09:00:00.000Z',
    });
    expect(
      evaluate(t, periodContaining(t, '2026-10-20')!, {
        reports: [],
        reviews: [],
        today,
      }).status,
    ).toBe('untracked');
    expect(
      pendingReviews(t, { reports: [], reviews: [], today }).map(s => s.start),
    ).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('upcoming periods and timezone-independent day keys', () => {
    const t = task({ startDate: '2026-11-01' });
    expect(currentState(t, { reports: [], reviews: [], today })).toBeNull();
    expect(
      evaluate(t, periodContaining(t, '2026-11-02')!, {
        reports: [],
        reviews: [],
        today,
      }).status,
    ).toBe('upcoming');
  });
});

describe('streaks and summaries', () => {
  it('counts consecutive met periods, including a met current one', () => {
    const t = task({ createdAt: '2026-10-01T00:00:00.000Z' });
    const reports = [
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ].map(d => report(d, 30));
    expect(streak(t, { reports, reviews: [], today: '2026-10-28' })).toBe(4);
    expect(
      streak(t, {
        reports: reports.slice(1),
        reviews: [],
        today: '2026-10-28',
      }),
    ).toBe(3);
  });

  it('describes targets in plain words', () => {
    const words = {
      everyDay: 'every day',
      everyWeek: 'every week',
      everyNDays: (k: number) => `every ${k} days`,
    };
    expect(
      describeTarget(
        { quantity: 30, frequency: 'daily', intervalDays: 1 },
        'minutes',
        words,
      ),
    ).toBe('30 minutes every day');
    expect(
      describeTarget(
        { quantity: 10, frequency: 'interval', intervalDays: 2 },
        'pages',
        words,
      ),
    ).toBe('10 pages every 2 days');
    expect(
      describeTarget(
        { quantity: 2.5, frequency: 'weekly', intervalDays: 7 },
        'hours',
        words,
      ),
    ).toBe('2.5 hours every week');
  });
});
