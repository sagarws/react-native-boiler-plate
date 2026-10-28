import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { lifeStore } from '../store/life.store';
import { historyEntries, toCsv } from '../components/tabs/HistoryTab';
import ManageLifeScreen from '../screens/ManageLifeScreen';
import ProjectFormScreen from '../screens/ProjectFormScreen';
import TaskFormScreen from '../screens/TaskFormScreen';
import ProjectDetailScreen from '../screens/ProjectDetailScreen';

let mockParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: { lifeRecommendations: jest.fn() },
}));
const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

const TODAY = '2026-10-28';
type Renderer = ReactTestRenderer.ReactTestRenderer;

/** A project with one daily "Read 30 minutes" task and 8 judged days. */
function seed({ history = true } = {}) {
  jest.setSystemTime(new Date('2026-10-14T09:00:00'));
  const p = lifeStore.createProject({
    name: 'Learn',
    icon: 'bookOpen',
    color: 'violet',
    startDate: '2026-10-14',
    deadline: '2026-12-31',
  });
  if (!p.ok) throw new Error(p.error);
  const t = lifeStore.createTask({
    projectId: p.value.id,
    name: 'Read',
    icon: 'bookOpen',
    color: 'violet',
    unit: 'minutes',
    target: { quantity: 30, frequency: 'daily', intervalDays: 1 },
    startDate: history ? '2026-10-20' : TODAY,
  });
  if (!t.ok) throw new Error(t.error);
  jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
  if (history) {
    for (const day of ['2026-10-20', '2026-10-21', '2026-10-24']) {
      lifeStore.addReport({ taskId: t.value.id, day, quantity: 30 }, TODAY);
    }
    for (const day of ['2026-10-22', '2026-10-23', '2026-10-25']) {
      lifeStore.addReport({ taskId: t.value.id, day, quantity: 10 }, TODAY);
      lifeStore.addReview(
        {
          taskId: t.value.id,
          periodStart: day,
          reason: 'unexpected_tasks',
          note: 'Work ran late',
        },
        TODAY,
      );
    }
    // 26 Oct: short and still waiting for a reason.
    lifeStore.addReport(
      { taskId: t.value.id, day: '2026-10-26', quantity: 5 },
      TODAY,
    );
  }
  return { project: p.value, task: t.value };
}

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
const texts = (r: Renderer) =>
  r.root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(n => n.children)
    .filter(c => typeof c === 'string')
    .join(' ');
const press = (r: Renderer, id: string) =>
  ReactTestRenderer.act(async () => {
    byId(r, id).props.onPress();
  });
const type = (r: Renderer, id: string, text: string) =>
  ReactTestRenderer.act(async () => {
    r.root
      .findAll(n => n.props.testID === id && 'onChangeText' in n.props)[0]
      .props.onChangeText(text);
  });

beforeEach(() => {
  jest.useFakeTimers();
  storage.clearAll();
  lifeStore.resetCacheForTest();
  mockParams = undefined;
  jest.clearAllMocks();
});
afterEach(() => {
  ReactTestRenderer.act(() => mounted.splice(0).forEach(r => r.unmount()));
  jest.useRealTimers();
});

describe('ManageLifeScreen', () => {
  it('shows the empty state and offers a first project', async () => {
    jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
    const r = await render(<ManageLifeScreen />);
    expect(has(r, 'life-empty')).toBe(true);
  });

  it('shows dashboard numbers and the pending reason', async () => {
    const { task } = seed();
    const r = await render(<ManageLifeScreen />);
    expect(has(r, 'stat-projects')).toBe(true);
    expect(has(r, 'life-pending')).toBe(true);
    expect(has(r, `pending-${task.id}-2026-10-26`)).toBe(true);
  });

  it('logs progress from Today and accumulates it', async () => {
    const { task } = seed();
    mockParams = { tab: 'today' };
    const r = await render(<ManageLifeScreen />);
    await press(r, `task-log-${task.id}`);
    await type(r, 'log-amount', '12');
    await press(r, 'log-save');
    await type(r, 'log-amount', '8');
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(6000); // past the duplicate guard
    });
    await press(r, 'log-save');
    const today = lifeStore
      .read()
      .reports.filter(x => x.taskId === task.id && x.day === TODAY);
    expect(today.map(x => x.quantity)).toEqual([12, 8]);
    expect(texts(r)).toContain('20');
  });

  it('rejects an invalid amount without saving', async () => {
    const { task } = seed();
    mockParams = { tab: 'today' };
    const r = await render(<ManageLifeScreen />);
    await press(r, `task-log-${task.id}`);
    await type(r, 'log-amount', '-3');
    await press(r, 'log-save');
    expect(lifeStore.read().reports.filter(x => x.day === TODAY)).toHaveLength(
      0,
    );
  });

  it('requires a reason (and a note for "other") at period end', async () => {
    const { task } = seed();
    const r = await render(<ManageLifeScreen />);
    await press(r, `pending-${task.id}-2026-10-26`);
    expect(byId(r, 'review-save').props.disabled).toBe(true);
    await press(r, 'review-reason-other');
    expect(byId(r, 'review-save').props.disabled).toBe(true);
    await type(r, 'review-note', 'Travelling');
    await press(r, 'review-save');
    const review = lifeStore
      .read()
      .reviews.find(
        x => x.taskId === task.id && x.periodStart === '2026-10-26',
      );
    expect(review).toMatchObject({ reason: 'other', note: 'Travelling' });
    expect(has(r, `pending-${task.id}-2026-10-26`)).toBe(false);
  });
});

describe('AI recommendations', () => {
  const reply = (text: string) =>
    JSON.stringify({ outcome: 'ok', text, status: 200, detail: '' });

  it('asks for more history before offering a request', async () => {
    seed({ history: false });
    mockParams = { tab: 'insights' };
    const r = await render(<ManageLifeScreen />);
    expect(has(r, 'ai-not-enough')).toBe(true);
    expect(has(r, 'ai-request')).toBe(false);
    expect(mockNative.lifeRecommendations).not.toHaveBeenCalled();
  });

  it('shows a friendly error and keeps the data unchanged', async () => {
    seed();
    mockNative.lifeRecommendations.mockResolvedValue(
      JSON.stringify({ outcome: 'no_internet', text: '', status: 0 }),
    );
    mockParams = { tab: 'insights' };
    const r = await render(<ManageLifeScreen />);
    const before = lifeStore.read().version;
    await press(r, 'ai-request');
    expect(has(r, 'ai-error')).toBe(true);
    expect(lifeStore.read().version).toBe(before);
  });

  it('applies a proposed target only after explicit acceptance', async () => {
    const { task } = seed();
    mockNative.lifeRecommendations.mockResolvedValue(
      reply(
        JSON.stringify({
          summary: 'Reading is on track about half the time.',
          recommendations: [
            {
              category: 'adjustment',
              title: 'Lower the daily target',
              explanation: 'Met on 3 of 7 days.',
              evidence: 'unexpected tasks 3 times',
              action: 'Try 20 minutes.',
              priority: 'high',
              taskName: 'Read',
              proposedTarget: {
                quantity: 20,
                frequency: 'daily',
                intervalDays: 1,
              },
            },
          ],
        }),
      ),
    );
    mockParams = { tab: 'insights' };
    const r = await render(<ManageLifeScreen />);
    await press(r, 'ai-request');
    expect(has(r, 'ai-results')).toBe(true);
    // Showing a proposal changes nothing.
    const targets = () =>
      lifeStore.read().tasks.find(x => x.id === task.id)!.targets;
    expect(targets()).toHaveLength(1);

    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await press(r, 'ai-review-0');
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => {
      buttons.find(b => b.style === 'cancel')!.onPress!();
    });
    expect(targets()).toHaveLength(1);

    await press(r, 'ai-review-0');
    await ReactTestRenderer.act(async () => {
      alert.mock.calls[1][2]!.find(b => b.style !== 'cancel')!.onPress!();
    });
    expect(targets()).toHaveLength(2);
    expect(targets()[1]).toMatchObject({
      quantity: 20,
      effectiveFrom: '2026-10-29',
    });
    // Past periods keep the old target.
    expect(targets()[0].quantity).toBe(30);
  });
});

describe('forms', () => {
  it('validates a project and keeps what was typed', async () => {
    jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
    const r = await render(<ProjectFormScreen />);
    await press(r, 'project-save');
    expect(has(r, 'project-error')).toBe(true);
    expect(lifeStore.read().projects).toHaveLength(0);
    await type(r, 'project-name', 'Fitness');
    await press(r, 'project-save');
    expect(lifeStore.read().projects.map(p => p.name)).toEqual(['Fitness']);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('creates a measurable task and summarises its target', async () => {
    const { project } = seed({ history: false });
    mockParams = { projectId: project.id };
    const r = await render(<TaskFormScreen />);
    await type(r, 'task-name', 'Walk');
    await type(r, 'task-quantity', '0');
    await press(r, 'task-save');
    expect(has(r, 'task-error')).toBe(true);
    await type(r, 'task-quantity', '5000');
    expect(texts(r)).toContain('5000');
    await press(r, 'task-save');
    expect(lifeStore.read().tasks.map(x => x.name)).toContain('Walk');
  });

  it('shows project detail actions with consequence confirmation', async () => {
    const { project } = seed();
    mockParams = { projectId: project.id };
    const r = await render(<ProjectDetailScreen />);
    expect(has(r, 'project-summary')).toBe(true);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await press(r, 'project-delete');
    expect(alert).toHaveBeenCalled();
    // Nothing is deleted until the user confirms.
    expect(lifeStore.read().projects).toHaveLength(1);
  });
});

describe('history', () => {
  it('"all activity" includes progress logged without a note', () => {
    seed();
    const all = historyEntries(
      lifeStore.read(),
      TODAY,
      'all',
      '2026-10-01',
      null,
      '',
    );
    // 7 reports (none with notes) + 3 reasons.
    expect(all.filter(e => e.kind === 'progress')).toHaveLength(7);
    expect(all.filter(e => e.kind === 'reason')).toHaveLength(3);
  });

  it('filters by kind and search and exports quoted CSV', () => {
    seed();
    const data = lifeStore.read();
    const reasons = historyEntries(
      data,
      TODAY,
      'reasons',
      '2026-10-01',
      null,
      '',
    );
    expect(reasons).toHaveLength(3);
    expect(
      historyEntries(data, TODAY, 'reasons', '2026-10-01', null, 'late'),
    ).toHaveLength(3);
    expect(
      historyEntries(data, TODAY, 'reasons', '2026-10-01', null, 'nothing'),
    ).toHaveLength(0);
    const csv = toCsv(reasons, () => 'Learn, "daily"');
    expect(csv.split('\n')[0]).toContain('type');
    expect(csv).toContain('"Learn, ""daily"""');
  });
});
