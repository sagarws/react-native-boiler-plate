import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { toggleKey } from '../components/progressCharts';
import ProjectDetailScreen from '../screens/ProjectDetailScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import { lifeStore } from '../store/life.store';

let mockParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

const TODAY = '2026-10-28';
type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];

async function render(node: React.ReactElement) {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r!);
  return r!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const press = (r: Renderer, id: string) =>
  ReactTestRenderer.act(async () => {
    r.root
      .findAll(
        n => n.props.testID === id && typeof n.props.onPress === 'function',
      )[0]
      .props.onPress({ nativeEvent: { locationX: 0 } });
  });
const textIn = (r: Renderer, id: string) =>
  r.root
    .findAll(n => n.props.testID === id)[0]
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => [n.props.children].flat().join(''))
    .join('\n');

/** "Learn": Read 30 minutes daily, Write 4 pages every 2 days. */
function seed() {
  jest.setSystemTime(new Date('2026-10-14T09:00:00'));
  const p = lifeStore.createProject({
    name: 'Learn',
    icon: 'bookOpen',
    color: 'violet',
    startDate: '2026-10-20',
    deadline: '2026-11-30',
  });
  if (!p.ok) throw new Error(p.error);
  const read = lifeStore.createTask({
    projectId: p.value.id,
    name: 'Read',
    icon: 'bookOpen',
    color: 'violet',
    unit: 'minutes',
    target: { quantity: 30, frequency: 'daily', intervalDays: 1 },
    startDate: '2026-10-20',
  });
  const write = lifeStore.createTask({
    projectId: p.value.id,
    name: 'Write',
    icon: 'pencil',
    color: 'teal',
    unit: 'pages',
    target: { quantity: 4, frequency: 'interval', intervalDays: 2 },
    startDate: '2026-10-20',
  });
  if (!read.ok || !write.ok) throw new Error('task');
  jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
  const log = (taskId: string, day: string, quantity: number, note = '') =>
    lifeStore.addReport({ taskId, day, quantity, note }, TODAY);
  log(read.value.id, '2026-10-20', 30, 'Chapter 1');
  log(read.value.id, '2026-10-21', 15);
  log(write.value.id, '2026-10-20', 2);
  lifeStore.addReview(
    {
      taskId: read.value.id,
      periodStart: '2026-10-22',
      reason: 'low_energy',
      note: 'Tired',
    },
    TODAY,
  );
  return { project: p.value, read: read.value, write: write.value };
}

beforeEach(() => {
  jest.useFakeTimers();
  storage.clearAll();
  lifeStore.resetCacheForTest();
  jest.clearAllMocks();
});
afterEach(() => {
  ReactTestRenderer.act(() => mounted.splice(0).forEach(r => r.unmount()));
  jest.useRealTimers();
});

describe('TaskDetailScreen', () => {
  it('shows the task, its counts and a shaded calendar', async () => {
    const { read } = seed();
    mockParams = { taskId: read.id };
    const r = await render(<TaskDetailScreen />);
    expect(textIn(r, 'task-info')).toContain('Learn');
    expect(textIn(r, 'task-info')).toContain('30 minutes every day');
    expect(textIn(r, 'task-stat-met')).toContain('1');
    expect(textIn(r, 'task-stat-missed')).toContain('7');
    // Calendar cells carry their percent, not just a colour.
    const cell = byId(r, 'task-calendar-day-2026-10-21');
    expect(cell.props.accessibilityLabel).toContain('50 percent of target');
    expect(textIn(r, 'task-calendar-day-2026-10-20')).toContain('100%');
    expect(
      byId(r, 'task-calendar-day-2026-10-23').props.accessibilityLabel,
    ).toContain('no progress reported');
  });

  it('selects a date to show its target, progress, notes and reason', async () => {
    const { read } = seed();
    mockParams = { taskId: read.id };
    const r = await render(<TaskDetailScreen />);
    await press(r, 'task-calendar-day-2026-10-20');
    expect(textIn(r, 'task-day-detail')).toContain('30 / 30 minutes (100%)');
    expect(textIn(r, 'task-day-detail')).toContain('Chapter 1');
    await press(r, 'task-calendar-day-2026-10-22');
    expect(textIn(r, 'task-day-detail')).toContain('Low energy');
    expect(textIn(r, 'task-day-detail')).toContain('Tired');
  });

  it('navigates months and marks days before the start as having no target', async () => {
    const { read } = seed();
    mockParams = { taskId: read.id };
    const r = await render(<TaskDetailScreen />);
    await press(r, 'task-calendar-prev');
    await press(r, 'task-calendar-day-2026-09-15');
    expect(textIn(r, 'task-day-detail')).toContain('No target is scheduled');
    await press(r, 'task-calendar-next');
    await press(r, 'task-calendar-next');
    expect(has(r, 'task-calendar-day-2026-11-15')).toBe(true);
  });

  it('charts target vs done per period and says when nothing is logged', async () => {
    const { read, write } = seed();
    mockParams = { taskId: read.id };
    const r = await render(<TaskDetailScreen />);
    expect(has(r, 'task-chart-bar-2026-10-21')).toBe(true);
    await press(r, 'task-chart-bar-2026-10-21');
    expect(textIn(r, 'task-chart-detail')).toContain('15 / 30 minutes (50%)');

    lifeStore.deleteReport(
      lifeStore.read().reports.find(x => x.taskId === write.id)!.id,
    );
    mockParams = { taskId: write.id };
    const r2 = await render(<TaskDetailScreen />);
    expect(has(r2, 'task-chart-empty')).toBe(true);
  });

  it('handles a deleted task', async () => {
    mockParams = { taskId: 'gone' };
    const r = await render(<TaskDetailScreen />);
    expect(has(r, 'task-missing')).toBe(true);
  });
});

describe('ProjectDetailScreen progress', () => {
  it('counts tasks and opens a task from its card', async () => {
    const { project, write } = seed();
    mockParams = { projectId: project.id };
    const r = await render(<ProjectDetailScreen />);
    // Both tasks owe reasons for missed periods.
    expect(textIn(r, 'project-count-overdue')).toContain('2');
    expect(textIn(r, 'project-count-completed')).toContain('0');
    expect(has(r, 'project-chart')).toBe(true);
    await press(r, `task-open-${write.id}`);
    expect(mockNavigate).toHaveBeenCalledWith('LifeTask', { taskId: write.id });
  });

  it('breaks a day down per task, normalised to each target', async () => {
    const { project, read } = seed();
    mockParams = { projectId: project.id };
    const r = await render(<ProjectDetailScreen />);
    await press(r, 'project-calendar-day-2026-10-20');
    const detail = textIn(r, 'project-day-detail');
    // Read 30/30 = 100%, Write 2/4 = 50% → 75% average; minutes and pages never added.
    expect(detail).toContain(
      '75% average completion across 2 scheduled task targets',
    );
    expect(detail).toContain('30 / 30 minutes');
    expect(detail).toContain('2 / 4 pages');
    await press(r, `project-day-task-${read.id}`);
    expect(mockNavigate).toHaveBeenCalledWith('LifeTask', { taskId: read.id });
  });

  it('shows or hides each line independently', async () => {
    const { project, read } = seed();
    mockParams = { projectId: project.id };
    const r = await render(<ProjectDetailScreen />);
    const toggle = (key: string) => byId(r, `project-chart-toggle-${key}`);
    expect(toggle('avg-actual').props.accessibilityState).toEqual({
      checked: true,
    });
    await press(r, 'project-chart-toggle-avg-actual');
    expect(toggle('avg-actual').props.accessibilityState).toEqual({
      checked: false,
    });
    expect(toggle('avg-target').props.accessibilityState).toEqual({
      checked: true,
    });
    expect(toggle(read.id).props.accessibilityState).toEqual({ checked: true });
    await press(r, `project-chart-toggle-${read.id}`);
    expect(toggle(read.id).props.accessibilityState).toEqual({
      checked: false,
    });

    // Step to the latest day: the readout lists only the visible lines.
    await ReactTestRenderer.act(async () => {
      byId(r, 'project-chart-plot').props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    const detail = textIn(r, 'project-chart-detail');
    expect(detail).toContain('Average planned');
    expect(detail).toContain('Write');
    expect(detail).not.toContain('Average done');
    expect(detail).not.toContain('Read');
  });
});

describe('toggleKey', () => {
  it('adds and removes keys without mutating', () => {
    const a = new Set(['x']);
    const b = toggleKey(a, 'y');
    expect([...b].sort()).toEqual(['x', 'y']);
    expect([...toggleKey(b, 'x')]).toEqual(['y']);
    expect([...a]).toEqual(['x']);
  });
});
