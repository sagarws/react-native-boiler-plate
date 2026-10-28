import { storage, StorageKeys } from '@/store/mmkv';
import {
  lifeStore,
  type ProjectInput,
  type TaskInput,
} from '../store/life.store';
import { evaluate, periodContaining } from '../services/periods';
import {
  dashboardSummary,
  dayDetail,
  projectProgress,
  quantitiesByTask,
  reasonBreakdown,
} from '../services/analytics';
import { suggestTargets } from '../services/targetHelp';

const TODAY = '2026-10-28';

const projectInput = (p: Partial<ProjectInput> = {}): ProjectInput => ({
  name: 'Improve Health',
  icon: 'gauge',
  color: 'emerald',
  startDate: '2026-10-01',
  deadline: '2026-12-31',
  ...p,
});

const taskInput = (
  projectId: string,
  t: Partial<TaskInput> = {},
): TaskInput => ({
  projectId,
  name: 'Walk',
  icon: 'gauge',
  color: 'emerald',
  unit: 'steps',
  target: { quantity: 5000, frequency: 'daily', intervalDays: 1 },
  startDate: '2026-10-20',
  ...t,
});

function setup() {
  const p = lifeStore.createProject(projectInput());
  if (!p.ok) throw new Error(p.error);
  const t = lifeStore.createTask(taskInput(p.value.id));
  if (!t.ok) throw new Error(t.error);
  return { project: p.value, task: t.value };
}

beforeEach(() => {
  jest.useFakeTimers();
  // Task "created" on Oct 20 so periods since then count.
  jest.setSystemTime(new Date('2026-10-20T09:00:00'));
  storage.clearAll();
  lifeStore.resetCacheForTest();
});
afterEach(() => jest.useRealTimers());

describe('projects', () => {
  it('validates, creates, edits, completes, archives, restores and persists', () => {
    expect(lifeStore.createProject(projectInput({ name: '  ' }))).toEqual({
      ok: false,
      error: 'name_required',
    });
    expect(
      lifeStore.createProject(projectInput({ deadline: '2026-09-01' })),
    ).toEqual({ ok: false, error: 'dates_invalid' });
    const { project } = setup();
    expect(
      lifeStore.updateProject(project.id, projectInput({ name: 'Health 2.0' }))
        .ok,
    ).toBe(true);
    lifeStore.setProjectStatus(project.id, 'completed');
    lifeStore.setProjectStatus(project.id, 'archived');
    lifeStore.setProjectStatus(project.id, 'active');
    lifeStore.resetCacheForTest(); // simulate an app restart
    const after = lifeStore.read();
    expect(after.projects[0]).toMatchObject({
      name: 'Health 2.0',
      status: 'active',
    });
    expect(after.tasks).toHaveLength(1);
  });

  it('deletes a project with its tasks and history', () => {
    const { project, task } = setup();
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    lifeStore.addReport({ taskId: task.id, day: TODAY, quantity: 1000 }, TODAY);
    lifeStore.deleteProject(project.id);
    expect(lifeStore.read()).toMatchObject({
      projects: [],
      tasks: [],
      reports: [],
      reviews: [],
    });
  });

  it('drops corrupt records instead of crashing', () => {
    storage.set(
      StorageKeys.LifeProjects,
      JSON.stringify([
        { id: 'x' },
        { id: 'ok', name: 'Fine', startDate: '2026-01-01' },
      ]),
    );
    storage.set(StorageKeys.LifeTasks, '{not json');
    lifeStore.resetCacheForTest();
    expect(lifeStore.read().projects.map(p => p.name)).toEqual(['Fine']);
    expect(lifeStore.read().tasks).toEqual([]);
  });
});

describe('tasks', () => {
  it('validates required fields, quantity and interval', () => {
    const { project } = setup();
    expect(lifeStore.createTask(taskInput(project.id, { name: '' })).ok).toBe(
      false,
    );
    expect(lifeStore.createTask(taskInput(project.id, { unit: ' ' }))).toEqual({
      ok: false,
      error: 'unit_required',
    });
    expect(
      lifeStore.createTask(
        taskInput(project.id, {
          target: { quantity: 0, frequency: 'daily', intervalDays: 1 },
        }),
      ),
    ).toEqual({
      ok: false,
      error: 'quantity_invalid',
    });
    expect(
      lifeStore.createTask(
        taskInput(project.id, {
          target: { quantity: 3, frequency: 'interval', intervalDays: 0 },
        }),
      ),
    ).toEqual({
      ok: false,
      error: 'interval_invalid',
    });
    const custom = lifeStore.createTask(
      taskInput(project.id, {
        name: 'Lessons',
        unit: 'lessons',
        target: { quantity: 3, frequency: 'interval', intervalDays: 14 },
      }),
    );
    expect(custom.ok && custom.value.targets[0]).toMatchObject({
      frequency: 'interval',
      intervalDays: 14,
      quantity: 3,
    });
  });

  it('editing a target keeps past periods and reports intact', () => {
    const { task } = setup();
    jest.setSystemTime(new Date('2026-10-25T09:00:00'));
    lifeStore.addReport(
      { taskId: task.id, day: '2026-10-24', quantity: 5000 },
      '2026-10-25',
    );
    lifeStore.changeTarget(
      task.id,
      { quantity: 8000, frequency: 'daily', intervalDays: 1 },
      '2026-10-25',
    );
    const edited = lifeStore.read().tasks[0];
    expect(edited.targets.map(v => [v.effectiveFrom, v.quantity])).toEqual([
      ['2026-10-20', 5000],
      ['2026-10-26', 8000],
    ]);
    const past = evaluate(edited, periodContaining(edited, '2026-10-24')!, {
      reports: lifeStore.read().reports,
      reviews: [],
      today: '2026-10-25',
    });
    expect(past).toMatchObject({ status: 'achieved', completed: 5000 });
  });

  it('pauses and resumes without making paused days "missed"', () => {
    const { task } = setup();
    jest.setSystemTime(new Date('2026-10-22T09:00:00'));
    lifeStore.pauseTask(task.id, 'Travel', '2026-10-22');
    jest.setSystemTime(new Date('2026-10-26T09:00:00'));
    lifeStore.resumeTask(task.id, '2026-10-26');
    const t = lifeStore.read().tasks[0];
    expect(t.pauses).toEqual([
      { from: '2026-10-22', to: '2026-10-25', reason: 'Travel' },
    ]);
    const s = evaluate(t, periodContaining(t, '2026-10-23')!, {
      reports: [],
      reviews: [],
      today: TODAY,
    });
    expect(s.status).toBe('paused');
  });
});

describe('progress reports', () => {
  it('accumulates entries, blocks double taps, and keeps an edit history', () => {
    const { task } = setup();
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    expect(
      lifeStore.addReport(
        { taskId: task.id, day: TODAY, quantity: 2000 },
        TODAY,
      ).ok,
    ).toBe(true);
    expect(
      lifeStore.addReport(
        { taskId: task.id, day: TODAY, quantity: 2000 },
        TODAY,
      ),
    ).toEqual({ ok: false, error: 'duplicate' });
    jest.setSystemTime(new Date('2026-10-28T12:00:00'));
    const second = lifeStore.addReport(
      { taskId: task.id, day: TODAY, quantity: 2000 },
      TODAY,
    );
    expect(second.ok).toBe(true);
    const t = lifeStore.read().tasks[0];
    const now = () =>
      evaluate(t, periodContaining(t, TODAY)!, {
        reports: lifeStore.read().reports,
        reviews: [],
        today: TODAY,
      });
    expect(now()).toMatchObject({
      completed: 4000,
      remaining: 1000,
      reportCount: 2,
    });

    if (!second.ok) throw new Error();
    lifeStore.editReport(second.value.id, {
      quantity: 1500,
      note: 'corrected',
    });
    expect(now()).toMatchObject({ completed: 3500 });
    expect(lifeStore.read().reports[1].edits).toEqual([
      expect.objectContaining({ quantity: 2000, note: '' }),
    ]);
  });

  it('rejects invalid quantities and days outside the task', () => {
    const { task } = setup();
    expect(
      lifeStore.addReport(
        { taskId: task.id, day: '2026-10-20', quantity: -1 },
        '2026-10-20',
      ).ok,
    ).toBe(false);
    expect(
      lifeStore.addReport(
        { taskId: task.id, day: '2026-10-19', quantity: 5 },
        '2026-10-20',
      ),
    ).toEqual({
      ok: false,
      error: 'day_out_of_range',
    });
    expect(
      lifeStore.addReport(
        { taskId: task.id, day: '2026-10-21', quantity: 5 },
        '2026-10-20',
      ),
    ).toEqual({
      ok: false,
      error: 'day_out_of_range',
    });
  });
});

describe('period-end reviews', () => {
  it('requires a reason ("Other" needs an explanation), once per period, only when unmet and ended', () => {
    const { task } = setup();
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    const add = (
      reason: Parameters<typeof lifeStore.addReview>[0]['reason'],
      note = '',
      periodStart = '2026-10-27',
    ) =>
      lifeStore.addReview(
        { taskId: task.id, periodStart, reason, note },
        TODAY,
      );
    expect(add('other')).toEqual({ ok: false, error: 'note_required' });
    expect(add('low_energy', '', TODAY)).toEqual({
      ok: false,
      error: 'period_open',
    });
    expect(add('other', 'Family visit').ok).toBe(true);
    expect(add('low_energy')).toEqual({ ok: false, error: 'already_reviewed' });

    lifeStore.addReport(
      { taskId: task.id, day: '2026-10-26', quantity: 6000 },
      TODAY,
    );
    expect(add('low_energy', '', '2026-10-26')).toEqual({
      ok: false,
      error: 'target_met',
    });
    expect(lifeStore.read().reviews[0]).toMatchObject({
      completedQuantity: 0,
      targetQuantity: 5000,
      reason: 'other',
    });
  });
});

describe('analytics from persisted records', () => {
  it('summarises the dashboard and lists pending reviews', () => {
    const { project, task } = setup();
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    lifeStore.addReport(
      { taskId: task.id, day: '2026-10-27', quantity: 5000 },
      TODAY,
    );
    lifeStore.addReport({ taskId: task.id, day: TODAY, quantity: 6000 }, TODAY);
    lifeStore.addReview(
      { taskId: task.id, periodStart: '2026-10-26', reason: 'distraction' },
      TODAY,
    );
    const d = lifeStore.read();
    const s = dashboardSummary(d, TODAY);
    expect(s).toMatchObject({
      activeProjects: 1,
      activeTasks: 1,
      doneToday: 1,
      dueToday: 1,
      todayPercent: 100,
    });
    // Oct 20–25 unmet without reasons (6), Oct 26 reviewed, Oct 27 met.
    expect(s.reportsRequired).toBe(6);
    expect(s.bestStreak).toBe(2);
    const progress = projectProgress(d, project, TODAY);
    expect(progress).toMatchObject({
      metPeriods: 1,
      judgedPeriods: 8,
      todayDone: 1,
    });
    expect(reasonBreakdown(d, '2026-10-01', TODAY)).toEqual([
      { reason: 'distraction', count: 1 },
    ]);
    expect(dayDetail(d, '2026-10-27', TODAY).mark).toBe('done');
    expect(dayDetail(d, '2026-10-24', TODAY).mark).toBe('pending');
    expect(dayDetail(d, '2026-10-10', TODAY).mark).toBe('none'); // no target that day
  });

  it('never adds quantities across different units', () => {
    const { project } = setup();
    const reading = lifeStore.createTask(
      taskInput(project.id, {
        name: 'Read',
        unit: 'pages',
        target: { quantity: 10, frequency: 'daily', intervalDays: 1 },
      }),
    );
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    const walk = lifeStore.read().tasks[0];
    lifeStore.addReport({ taskId: walk.id, day: TODAY, quantity: 3000 }, TODAY);
    if (reading.ok)
      lifeStore.addReport(
        { taskId: reading.value.id, day: TODAY, quantity: 12 },
        TODAY,
      );
    const q = quantitiesByTask(lifeStore.read(), TODAY, TODAY, TODAY);
    expect(q.map(x => [x.unit, x.actual])).toEqual([
      ['steps', 3000],
      ['pages', 12],
    ]);
  });
});

describe('help me set a target (rule-based)', () => {
  it('suggests from a goal and deadline, a baseline, available time and history', () => {
    const s = suggestTargets({
      frequency: 'daily',
      intervalDays: 1,
      goalTotal: 600,
      daysToDeadline: 30,
      baseline: 15,
      minutesPerDay: 40,
      unitIsMinutes: true,
      history: [
        { completed: 10, target: 30 },
        { completed: 30, target: 30 },
        { completed: 12, target: 30 },
        { completed: 14, target: 30 },
      ],
    });
    expect(s.map(x => [x.basis, x.quantity])).toEqual([
      ['deadline', 20],
      ['baseline', 17],
      ['time', 32],
      ['history_lower', 18],
    ]);
  });
});
