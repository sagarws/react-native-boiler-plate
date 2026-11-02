import {
  levelFor,
  percentOf,
  projectCalendar,
  projectChart,
  projectWindow,
  sampleDays,
  standingCounts,
  taskCalendar,
  taskPeriodBars,
  taskStanding,
  taskSummary,
} from '../services/progress';
import type {
  DayKey,
  PeriodReview,
  ProgressReport,
  Project,
  Task,
  TargetVersion,
} from '../types';

const TODAY = '2026-10-28'; // a Wednesday

const project: Project = {
  id: 'p',
  name: 'Learn',
  description: '',
  objective: '',
  successCriteria: '',
  category: '',
  priority: 'medium',
  notes: '',
  icon: 'layers',
  imageUri: '',
  color: 'violet',
  startDate: '2026-10-20',
  deadline: '2026-10-31',
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function task(
  id: string,
  target: Partial<TargetVersion>,
  over: Partial<Task> = {},
): Task {
  return {
    id,
    projectId: 'p',
    name: id,
    description: '',
    icon: 'circleCheck',
    imageUri: '',
    color: 'violet',
    unit: 'minutes',
    targets: [
      {
        effectiveFrom: '2026-10-20',
        quantity: 30,
        frequency: 'daily',
        intervalDays: 1,
        ...target,
      },
    ],
    startDate: '2026-10-20',
    endDate: null,
    priority: 'medium',
    status: 'active',
    focusDay: null,
    pauses: [],
    notes: '',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

let n = 0;
const report = (
  taskId: string,
  day: DayKey,
  quantity: number,
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

const inp = (reports: ProgressReport[], reviews: PeriodReview[] = []) => ({
  reports,
  reviews,
  today: TODAY,
});

describe('levels', () => {
  it('classifies completion into neutral, low, partial, high, full', () => {
    expect(levelFor(null)).toBe('none');
    expect(levelFor(0)).toBe('none');
    expect(levelFor(0.1)).toBe('low');
    expect(levelFor(0.34)).toBe('partial');
    expect(levelFor(0.7)).toBe('high');
    expect(levelFor(1)).toBe('full');
    expect(levelFor(1.8)).toBe('full');
    expect(levelFor(NaN)).toBe('none');
    expect(percentOf(1.8)).toBe(100);
    expect(percentOf(0.255)).toBe(26);
  });
});

describe('task calendar', () => {
  it('daily: each day against its own target; no report stays neutral', () => {
    const t = task('read', {});
    const cal = taskCalendar(
      t,
      inp([report('read', '2026-10-21', 15), report('read', '2026-10-22', 30)]),
      '2026-10-19',
      '2026-10-24',
    );
    expect(cal['2026-10-19']).toMatchObject({ state: null, level: 'none' }); // before start
    expect(cal['2026-10-20']).toMatchObject({ level: 'none', percent: null }); // no report
    expect(cal['2026-10-21']).toMatchObject({ level: 'partial', percent: 50 });
    expect(cal['2026-10-22']).toMatchObject({ level: 'full', percent: 100 });
  });

  it('weekly: the whole week shares its period completion', () => {
    const t = task('run', {
      frequency: 'weekly',
      intervalDays: 7,
      quantity: 20,
    });
    const cal = taskCalendar(
      t,
      inp([report('run', '2026-10-21', 5), report('run', '2026-10-23', 10)]),
      '2026-10-20',
      '2026-10-26',
    );
    // Week of Mon 19 Oct (partial first week from the 20th) → 15/20 = 75%.
    for (const d of ['2026-10-20', '2026-10-22', '2026-10-25']) {
      expect(cal[d]).toMatchObject({ level: 'high', percent: 75 });
    }
    expect(cal['2026-10-26'].level).toBe('none'); // next week, nothing yet
  });

  it('every N days: the period colours all its days', () => {
    const t = task('gym', {
      frequency: 'interval',
      intervalDays: 3,
      quantity: 2,
    });
    const cal = taskCalendar(
      t,
      inp([report('gym', '2026-10-24', 1)]),
      '2026-10-20',
      '2026-10-26',
    );
    expect(cal['2026-10-20'].level).toBe('none'); // 20–22 nothing reported
    expect(cal['2026-10-23']).toMatchObject({ level: 'partial', percent: 50 }); // 23–25
    expect(cal['2026-10-25'].percent).toBe(50);
    expect(cal['2026-10-23'].state?.start).toBe('2026-10-23');
  });

  it('paused and future periods are neutral', () => {
    const t = task(
      'read',
      {},
      {
        pauses: [{ from: '2026-10-21', to: '2026-10-21', reason: '' }],
      },
    );
    const cal = taskCalendar(
      t,
      inp([report('read', '2026-10-21', 30), report('read', '2026-10-29', 30)]),
      '2026-10-21',
      '2026-10-29',
    );
    expect(cal['2026-10-21'].level).toBe('none');
    expect(cal['2026-10-29'].level).toBe('none');
  });
});

describe('task summary and bars', () => {
  it('counts met and missed ended periods and keeps reasons', () => {
    const t = task('read', {});
    const review: PeriodReview = {
      id: 'v',
      taskId: 'read',
      periodStart: '2026-10-21',
      periodEnd: '2026-10-21',
      targetQuantity: 30,
      completedQuantity: 0,
      reason: 'low_energy',
      note: 'Tired',
      createdAt: '',
      updatedAt: '',
    };
    const s = taskSummary(
      t,
      inp(
        [report('read', '2026-10-20', 30), report('read', TODAY, 10)],
        [review],
      ),
    );
    // 20th met; 21st–27th missed (one with a reason, six still needing one).
    expect(s.met).toBe(1);
    expect(s.missed).toBe(7);
    expect(s.successRate).toBe(13);
    expect(s.current?.completed).toBe(10);
    expect(s.reviews).toEqual([review]);
  });

  it('bars keep target and actual in the task unit, null when unreported', () => {
    const t = task('read', {});
    const bars = taskPeriodBars(
      t,
      inp([report('read', '2026-10-21', 45)]),
      '2026-10-20',
      '2026-10-21',
    );
    expect(bars).toEqual([
      expect.objectContaining({
        start: '2026-10-20',
        target: 30,
        completed: 0,
        ratio: null,
      }),
      expect.objectContaining({
        start: '2026-10-21',
        target: 30,
        completed: 45,
        ratio: 1.5,
      }),
    ]);
  });
});

describe('project calendar', () => {
  const minutes = task('read', { quantity: 30 });
  const pages = task('write', { quantity: 4 }, { unit: 'pages' });
  const weekly = task(
    'run',
    { frequency: 'weekly', intervalDays: 7, quantity: 10 },
    {
      startDate: '2026-10-26',
      targets: [
        {
          effectiveFrom: '2026-10-26',
          quantity: 10,
          frequency: 'weekly',
          intervalDays: 7,
        },
      ],
    },
  );

  it('averages each task against its own target, never mixing units', () => {
    const cal = projectCalendar(
      [minutes, pages, weekly],
      inp([
        report('read', '2026-10-21', 60), // 200% → capped at 100%
        report('write', '2026-10-21', 1), // 25%
      ]),
      '2026-10-20',
      '2026-10-26',
    );
    const d = cal['2026-10-21'];
    expect(d.scheduled.map(x => x.task.id)).toEqual(['read', 'write']); // run not started
    expect(d.average).toBeCloseTo(0.625);
    expect(d).toMatchObject({ level: 'partial', percent: 63 });
  });

  it('counts an unreported scheduled task as 0, but is neutral when nothing is reported', () => {
    const cal = projectCalendar(
      [minutes, pages],
      inp([report('read', '2026-10-22', 30)]),
      '2026-10-22',
      '2026-10-23',
    );
    expect(cal['2026-10-22']).toMatchObject({ average: 0.5, level: 'partial' });
    expect(cal['2026-10-23']).toMatchObject({ average: null, level: 'none' });
  });

  it('is neutral on days with no scheduled target', () => {
    const cal = projectCalendar([weekly], inp([]), '2026-10-20', '2026-10-25');
    expect(cal['2026-10-20']).toMatchObject({ scheduled: [], level: 'none' });
  });
});

describe('project chart', () => {
  it('cumulative actual vs planned per task, normalised to each plan', () => {
    // 12 days × 30 min = 360 planned; a 2-day "every 2 days" pages task: 6 periods × 4 = 24.
    const read = task('read', { quantity: 30 });
    const write = task(
      'write',
      { frequency: 'interval', intervalDays: 2, quantity: 4 },
      { unit: 'pages' },
    );
    const chart = projectChart(
      project,
      [read, write],
      [
        report('read', '2026-10-20', 90), // capped to 30
        report('read', '2026-10-21', 30),
        report('write', '2026-10-20', 4),
      ],
      ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-31'],
    );
    const [r, w] = chart.tasks;
    expect(r.planTotal).toBe(360);
    expect(w.planTotal).toBe(24);
    expect(r.actual).toEqual([null, 8.3, 16.7, 16.7]);
    expect(r.planned).toEqual([null, 8.3, 16.7, 100]);
    // Writing: period 20–21 → half elapsed on the 20th (2 of 24 planned).
    expect(w.planned).toEqual([null, 8.3, 16.7, 100]);
    expect(w.actual).toEqual([null, 16.7, 16.7, 16.7]);
    expect(chart.averageActual).toEqual([null, 12.5, 16.7, 16.7]);
    expect(chart.averageTarget).toEqual([null, 8.3, 16.7, 100]);
  });

  it('leaves out paused periods and tasks without a plan', () => {
    const paused = task(
      'read',
      {},
      {
        pauses: [{ from: '2026-10-25', to: null, reason: '' }],
      },
    );
    const late = task('late', {}, { startDate: '2026-11-05' });
    const chart = projectChart(project, [paused, late], [], ['2026-10-31']);
    expect(chart.tasks.map(s => s.task.id)).toEqual(['read']);
    expect(chart.tasks[0].planTotal).toBe(150); // 20–24 only
  });

  it('samples days evenly with both ends', () => {
    expect(sampleDays('2026-10-01', '2026-10-05')).toHaveLength(5);
    const many = sampleDays('2026-01-01', '2026-12-31', 10);
    expect(many).toHaveLength(10);
    expect(many[0]).toBe('2026-01-01');
    expect(many[9]).toBe('2026-12-31');
    expect(sampleDays('2026-02-01', '2026-01-01')).toEqual([]);
  });

  it('windows from the project start to today within the deadline', () => {
    expect(projectWindow(project, [], TODAY)).toEqual({
      from: '2026-10-20',
      to: TODAY,
    });
    expect(projectWindow(project, [], '2026-12-01').to).toBe('2026-10-31');
  });
});

describe('task standing', () => {
  it('splits tasks into completed, overdue and pending', () => {
    const done = task('a', {}, { status: 'completed' });
    const ended = task('b', {}, { endDate: '2026-10-25' });
    const owes = task('c', {});
    const fine = task(
      'd',
      {},
      {
        startDate: TODAY,
        targets: [
          {
            effectiveFrom: TODAY,
            quantity: 1,
            frequency: 'daily',
            intervalDays: 1,
          },
        ],
      },
    );
    const i = inp([]);
    expect(taskStanding(owes, i)).toBe('overdue');
    expect(standingCounts([done, ended, owes, fine], i)).toEqual({
      completed: 1,
      overdue: 2,
      pending: 1,
    });
  });
});
