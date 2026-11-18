import {
  averageAt,
  chartDates,
  initialHidden,
  levelFor,
  projectChart,
  projectDayCell,
  projectOverall,
  scheduleProgress,
  taskCounts,
  taskDayCell,
  taskPeriodPage,
  taskStats,
  toggleLine,
} from '../services/progress';
import type {
  PeriodReview,
  ProgressReport,
  Project,
  Task,
  TargetVersion,
} from '../types';

const TODAY = '2026-10-28'; // a Wednesday

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
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  ...t,
});

const project = (p: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Learn',
  description: '',
  objective: '',
  successCriteria: '',
  category: '',
  priority: 'medium',
  notes: '',
  icon: 'bookOpen',
  imageUri: '',
  color: 'violet',
  startDate: '2026-10-01',
  deadline: '2026-10-31',
  status: 'active',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  ...p,
});

let n = 0;
const report = (
  day: string,
  quantity: number,
  taskId = 't1',
): ProgressReport => ({
  id: `r${n++}`,
  taskId,
  day,
  quantity,
  note: '',
  reportedAt: `${day}T10:00:00.000Z`,
  createdAt: `${day}T10:00:00.000Z`,
  updatedAt: `${day}T10:00:00.000Z`,
  edits: [],
});

const review = (taskId: string, day: string): PeriodReview => ({
  id: `v${n++}`,
  taskId,
  periodStart: day,
  periodEnd: day,
  targetQuantity: 30,
  completedQuantity: 0,
  reason: 'low_energy',
  note: '',
  createdAt: `${day}T23:00:00.000Z`,
  updatedAt: `${day}T23:00:00.000Z`,
});

const input = (
  reports: ProgressReport[] = [],
  reviews: PeriodReview[] = [],
  today = TODAY,
) => ({ reports, reviews, today });

describe('levelFor (calendar colour classification)', () => {
  it.each([
    [0, 'low'],
    [0.2, 'low'],
    [0.339, 'low'],
    [0.34, 'partial'],
    [0.66, 'partial'],
    [0.67, 'high'],
    [0.99, 'high'],
    [1, 'full'],
    [1.75, 'full'],
  ])('%s → %s', (ratio, level) => {
    expect(levelFor(ratio)).toBe(level);
  });

  it('treats a non-finite ratio as low', () => {
    expect(levelFor(NaN)).toBe('low');
  });
});

describe('taskDayCell', () => {
  it('computes a daily completion percentage from the saved reports', () => {
    const cell = taskDayCell(
      task(),
      '2026-10-20',
      input([report('2026-10-20', 10), report('2026-10-20', 5)]),
    );
    expect(cell.percent).toBe(50);
    expect(cell.level).toBe('partial');
    expect(cell.state?.completed).toBe(15);
  });

  it('marks an exceeded target as full and keeps the real percent', () => {
    const cell = taskDayCell(
      task(),
      '2026-10-20',
      input([report('2026-10-20', 45)]),
    );
    expect(cell.level).toBe('full');
    expect(cell.percent).toBe(150);
  });

  it('separates "no target scheduled" from "scheduled but not reported"', () => {
    const t = task({ startDate: '2026-10-10', endDate: '2026-10-25' });
    expect(taskDayCell(t, '2026-10-05', input()).level).toBe('none');
    expect(taskDayCell(t, '2026-10-26', input()).level).toBe('none');
    const missing = taskDayCell(t, '2026-10-12', input());
    expect(missing.level).toBe('noReport');
    expect(missing.percent).toBeNull();
  });

  it('shows no target on future days and on paused or pre-tracking days', () => {
    expect(taskDayCell(task(), '2026-10-30', input()).level).toBe('none');
    const paused = task({
      pauses: [{ from: '2026-10-10', to: '2026-10-12', reason: '' }],
    });
    expect(taskDayCell(paused, '2026-10-11', input()).level).toBe('none');
    const late = task({ createdAt: '2026-10-20T08:00:00.000Z' });
    expect(taskDayCell(late, '2026-10-05', input()).level).toBe('none');
  });

  it('colours a weekly target period as a whole, up to today', () => {
    const weekly = task({
      targets: [target({ frequency: 'weekly', intervalDays: 7, quantity: 70 })],
    });
    const inp = input([report('2026-10-27', 35)]);
    // Week of Mon 26 Oct: 35 / 70 = 50% on each day so far.
    for (const d of ['2026-10-26', '2026-10-27', '2026-10-28']) {
      const c = taskDayCell(weekly, d, inp);
      expect(c.percent).toBe(50);
      expect(c.state?.start).toBe('2026-10-26');
      expect(c.state?.end).toBe('2026-11-01');
    }
    // Later days of the same week aren't due yet.
    expect(taskDayCell(weekly, '2026-10-30', inp).level).toBe('none');
  });

  it('colours an every-N-days period as a whole', () => {
    const every3 = task({
      targets: [
        target({ frequency: 'interval', intervalDays: 3, quantity: 9 }),
      ],
    });
    const inp = input([report('2026-10-02', 9)]);
    const cells = ['2026-10-01', '2026-10-02', '2026-10-03'].map(d =>
      taskDayCell(every3, d, inp),
    );
    expect(
      cells.every(c => c.level === 'full' && c.state?.start === '2026-10-01'),
    ).toBe(true);
    expect(taskDayCell(every3, '2026-10-04', inp).level).toBe('noReport');
  });
});

describe('projectDayCell', () => {
  const minutes = task({
    id: 'a',
    unit: 'minutes',
    targets: [target({ quantity: 30 })],
  });
  const pages = task({
    id: 'b',
    unit: 'pages',
    targets: [target({ quantity: 10 })],
  });

  it('averages each task against its own target, never adding units', () => {
    const cell = projectDayCell(
      [minutes, pages],
      '2026-10-20',
      input([report('2026-10-20', 30, 'a'), report('2026-10-20', 2, 'b')]),
    );
    // (100% + 20%) / 2 — not (30 + 2) / (30 + 10).
    expect(cell.percent).toBe(60);
    expect(cell.level).toBe('partial');
    expect(cell.states).toHaveLength(2);
  });

  it('caps an over-achieved task at 100% and counts a missing report as 0%', () => {
    const cell = projectDayCell(
      [minutes, pages],
      '2026-10-20',
      input([report('2026-10-20', 90, 'a')]),
    );
    expect(cell.percent).toBe(50);
  });

  it('only includes tasks with a target scheduled that day', () => {
    const later = task({ ...pages, startDate: '2026-10-25' });
    const cell = projectDayCell(
      [minutes, later],
      '2026-10-20',
      input([report('2026-10-20', 30, 'a')]),
    );
    expect(cell.states.map(s => s.task.id)).toEqual(['a']);
    expect(cell.level).toBe('full');
  });

  it('is neutral with no scheduled target, and "not reported" with no reports', () => {
    const later = task({ startDate: '2026-10-25' });
    expect(projectDayCell([later], '2026-10-20', input()).level).toBe('none');
    expect(projectDayCell([minutes], '2026-10-20', input()).level).toBe(
      'noReport',
    );
    expect(projectDayCell([minutes], '2026-10-30', input()).level).toBe('none');
  });
});

describe('taskPeriodPage', () => {
  it('pages back through periods, newest last', () => {
    const t = task({ startDate: '2026-10-15' }); // 14 periods to today
    const first = taskPeriodPage(t, input(), 7, 0);
    expect(first.states.map(s => s.start)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
    ]);
    expect(first).toMatchObject({ hasOlder: true, hasNewer: false });
    const older = taskPeriodPage(t, input(), 7, 1);
    expect(older.states[0].start).toBe('2026-10-15');
    expect(older).toMatchObject({ hasOlder: false, hasNewer: true });
  });

  it('is empty before the first period starts', () => {
    expect(
      taskPeriodPage(task({ startDate: '2026-11-01' }), input(), 7).states,
    ).toEqual([]);
  });
});

describe('scheduleProgress (target-progress line)', () => {
  it('accrues a daily plan day by day', () => {
    const t = task({
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      targets: [target({ quantity: 10 })],
    });
    const p = scheduleProgress(
      t,
      input([report('2026-10-02', 10), report('2026-10-04', 20)]),
      '2026-10-31',
      '2026-10-05',
    )!;
    expect(p.plannedTotal).toBe(100);
    expect(p.targetPercent).toBe(50);
    expect(p.actual).toBe(30);
    expect(p.actualPercent).toBe(30);
  });

  it('spreads a weekly target evenly across its days', () => {
    const t = task({
      startDate: '2026-10-05', // Monday
      targets: [
        target({
          frequency: 'weekly',
          intervalDays: 7,
          quantity: 70,
          effectiveFrom: '2026-10-05',
        }),
      ],
    });
    const p = scheduleProgress(t, input(), '2026-10-18', '2026-10-07')!;
    expect(p.plannedTotal).toBe(140);
    // 3 of 7 days of week one → 30 of 140.
    expect(p.targetPercent).toBeCloseTo((30 / 140) * 100);
  });

  it('plans nothing for paused periods and returns null when nothing is planned', () => {
    const t = task({
      startDate: '2026-10-01',
      endDate: '2026-10-04',
      pauses: [{ from: '2026-10-01', to: null, reason: '' }],
    });
    expect(scheduleProgress(t, input(), '2026-10-31', '2026-10-03')).toBeNull();
  });
});

describe('projectChart', () => {
  const p = project({ startDate: '2026-10-01', deadline: '2026-10-31' });

  it('normalises each task to its own plan and averages them', () => {
    const a = task({
      id: 'a',
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      targets: [target({ quantity: 10 })],
    });
    const b = task({
      id: 'b',
      unit: 'pages',
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      targets: [target({ quantity: 2 })],
    });
    const chart = projectChart(
      p,
      [a, b],
      input(
        [report('2026-10-01', 100, 'a'), report('2026-10-01', 4, 'b')],
        [],
        '2026-10-05',
      ),
      31,
    );
    const i = chart.dates.indexOf('2026-10-05');
    const [la, lb] = chart.tasks;
    expect(la.actual[i]).toBe(100); // 100 of 100 minutes
    expect(lb.actual[i]).toBe(20); // 4 of 20 pages
    expect(la.target[i]).toBe(50);
    expect(chart.avgActual[i]).toBe(60);
    expect(chart.avgTarget[i]).toBe(50);
    // No actual values after today; the plan continues.
    const later = chart.dates.indexOf('2026-10-08');
    expect(la.actual[later]).toBeNull();
    expect(chart.avgActual[later]).toBeNull();
    expect(chart.avgTarget[later]).toBe(80);
  });

  it("leaves a task out of a date's average before it starts", () => {
    const a = task({
      id: 'a',
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      targets: [target({ quantity: 10 })],
    });
    const b = task({ id: 'b', startDate: '2026-10-20', endDate: '2026-10-29' });
    const chart = projectChart(p, [a, b], input([], [], TODAY), 31);
    const i = chart.dates.indexOf('2026-10-05');
    expect(chart.tasks[1].target[i]).toBeNull();
    expect(chart.avgTarget[i]).toBe(50);
  });

  it('lists tasks with nothing planned as skipped', () => {
    const paused = task({
      id: 'z',
      pauses: [{ from: '2026-10-01', to: null, reason: '' }],
    });
    const chart = projectChart(p, [paused], input());
    expect(chart.tasks).toEqual([]);
    expect(chart.skipped.map(t => t.id)).toEqual(['z']);
  });

  it('gives the overall project progress for today', () => {
    const a = task({
      id: 'a',
      startDate: '2026-10-01',
      endDate: '2026-10-10',
      targets: [target({ quantity: 10 })],
    });
    expect(
      projectOverall(
        p,
        [a],
        input([report('2026-10-02', 25, 'a')], [], '2026-10-05'),
      ),
    ).toEqual({
      actual: 25,
      target: 50,
    });
    expect(projectOverall(p, [], input())).toBeNull();
  });
});

describe('averageAt', () => {
  it('averages only the series with a value, with an optional cap', () => {
    expect(
      averageAt(
        ['d1', 'd2', 'd3'],
        [
          [10, null, 150],
          [30, null, 50],
        ],
        v => Math.min(100, v),
      ),
    ).toEqual([20, null, 75]);
  });
});

describe('chartDates', () => {
  it('spans start to end and includes today', () => {
    const dates = chartDates('2026-10-01', '2026-12-31', '2026-10-28', 6);
    expect(dates[0]).toBe('2026-10-01');
    expect(dates[dates.length - 1]).toBe('2026-12-31');
    expect(dates).toContain('2026-10-28');
    expect(dates.length).toBeLessThanOrEqual(6);
    expect([...dates].sort()).toEqual(dates);
  });

  it('uses every day for a short range', () => {
    expect(chartDates('2026-10-01', '2026-10-03', TODAY)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
  });
});

describe('chart line visibility', () => {
  it('toggles one line at a time', () => {
    const hidden = toggleLine(new Set(), 'avgTarget');
    expect([...hidden]).toEqual(['avgTarget']);
    const shown = toggleLine(hidden, 'avgTarget');
    expect(shown.size).toBe(0);
    // The original set is not changed.
    expect(hidden.has('avgTarget')).toBe(true);
  });

  it('hides task lines past the first five at first', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect([...initialHidden(ids)]).toEqual(['f', 'g']);
    expect(initialHidden(ids.slice(0, 3)).size).toBe(0);
  });
});

describe('taskStats and taskCounts', () => {
  it('counts met and missed periods (with or without a reason)', () => {
    const t = task({ startDate: '2026-10-24' });
    const stats = taskStats(
      t,
      input(
        [
          report('2026-10-24', 30),
          report('2026-10-25', 10),
          report('2026-10-28', 40),
        ],
        [review('t1', '2026-10-25')],
      ),
      null,
    );
    expect(stats.met).toBe(1); // 24th
    expect(stats.missed).toBe(3); // 25th (reason), 26th, 27th (no reason)
    expect(stats.reasonNeeded).toBe(2);
    expect(stats.current?.met).toBe(true);
    expect(stats.overall).toBeNull();
  });

  it('gives the next target period of a task that has not started', () => {
    const stats = taskStats(
      task({ startDate: '2026-11-02' }),
      input(),
      '2026-11-30',
    );
    expect(stats.current).toBeNull();
    expect(stats.next?.start).toBe('2026-11-02');
  });

  it('splits project tasks into completed, pending and overdue', () => {
    const p = project({ deadline: '2026-12-31' });
    expect(
      taskCounts(
        [
          task({ id: '1', status: 'completed', endDate: '2026-10-01' }),
          task({ id: '2', endDate: '2026-10-20' }),
          task({ id: '3' }),
        ],
        p,
        TODAY,
      ),
    ).toEqual({ completed: 1, pending: 1, overdue: 1 });
  });
});
