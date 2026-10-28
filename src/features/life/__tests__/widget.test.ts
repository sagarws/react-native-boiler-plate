import { storage } from '@/store/mmkv';
import { parseWidgetLogs } from '@/features/capture/services/lifeWidget.service';
import { lifeStore } from '../store/life.store';
import {
  buildWidgetSnapshot,
  importWidgetLogs,
  type WidgetLabels,
} from '../services/widget';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: null,
}));

const TODAY = '2026-10-28'; // a Wednesday
const labels: WidgetLabels = {
  title: 'Today',
  empty: 'None',
  setup: 'Set up',
  met: 'Met',
  endsToday: 'Ends today',
  endsOn: 'Ends %s',
  stale: 'Open app',
  more: '+%d more',
};

function seed() {
  const p = lifeStore.createProject({
    name: 'Health',
    icon: 'gauge',
    color: 'emerald',
    startDate: '2026-10-01',
    deadline: '2026-12-31',
  });
  if (!p.ok) throw new Error(p.error);
  const make = (name: string, extra: object) => {
    const t = lifeStore.createTask({
      projectId: p.value.id,
      name,
      icon: 'gauge',
      color: 'teal',
      unit: 'steps',
      target: { quantity: 4400, frequency: 'daily', intervalDays: 1 },
      startDate: '2026-10-20',
      ...extra,
    });
    if (!t.ok) throw new Error(t.error);
    return t.value;
  };
  const walk = make('Walk', {});
  const read = make('Read', {
    unit: 'pages',
    priority: 'high',
    target: { quantity: 100, frequency: 'weekly', intervalDays: 7 },
  });
  const paused = make('Swim', {});
  lifeStore.pauseTask(paused.id, '', TODAY);
  return { walk, read, paused };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
  storage.clearAll();
  lifeStore.resetCacheForTest();
});
afterEach(() => jest.useRealTimers());

describe('widget snapshot', () => {
  it('lists active tasks with progress, current and upcoming periods', () => {
    const { walk, read } = seed();
    lifeStore.addReport({ taskId: walk.id, day: TODAY, quantity: 1500 }, TODAY);
    lifeStore.addReport(
      { taskId: read.id, day: '2026-10-26', quantity: 30 },
      TODAY,
    );
    const snap = JSON.parse(
      buildWidgetSnapshot(lifeStore.read(), TODAY, labels),
    );
    expect(snap.labels.endsOn).toBe('Ends %s');
    // High priority first; the paused task is left out.
    expect(snap.tasks.map((t: { name: string }) => t.name)).toEqual([
      'Read',
      'Walk',
    ]);
    const [r, w] = snap.tasks;
    // Weekly: the whole Mon–Sun week, with the week's progress so far.
    expect(r.periods[0]).toEqual({
      s: '2026-10-26',
      e: '2026-11-01',
      t: 100,
      c: 30,
    });
    expect(r.step).toBe(25);
    expect(w.periods[0]).toEqual({ s: TODAY, e: TODAY, t: 4400, c: 1500 });
    // Tomorrow is ready for the widget, with no progress yet.
    expect(w.periods[1]).toEqual({
      s: '2026-10-29',
      e: '2026-10-29',
      t: 4400,
      c: 0,
    });
    expect(w.periods.length).toBeGreaterThanOrEqual(14);
    expect(w.step).toBe(1100);
    expect(w.color).toMatch(/^#/);
  });

  it('is empty when nothing is due', () => {
    const snap = JSON.parse(
      buildWidgetSnapshot(lifeStore.read(), TODAY, labels),
    );
    expect(snap.tasks).toEqual([]);
  });
});

describe('widget quick logs', () => {
  it('sums taps per task and day into one entry each', () => {
    const { walk } = seed();
    const at = Date.parse(`${TODAY}T08:00:00`);
    const saved = importWidgetLogs(
      [
        { id: 'a', task: walk.id, day: TODAY, q: 1100, at },
        { id: 'b', task: walk.id, day: TODAY, q: 1100, at: at + 1000 },
        { id: 'c', task: walk.id, day: '2026-10-27', q: 1100, at },
        { id: 'd', task: 'deleted-task', day: TODAY, q: 5, at },
      ],
      TODAY,
    );
    expect(saved).toBe(2);
    const reports = lifeStore.read().reports;
    expect(reports.find(r => r.day === TODAY)?.quantity).toBe(2200);
    expect(reports.find(r => r.day === '2026-10-27')?.quantity).toBe(1100);
  });

  it('parses the native queue and drops malformed entries', () => {
    expect(
      parseWidgetLogs(
        JSON.stringify([
          { id: 'a', task: 't', day: TODAY, q: 2, at: 1 },
          { id: 'b', task: 't', day: 'yesterday', q: 2, at: 1 },
          { id: 'c', task: 't', day: TODAY, q: -1, at: 1 },
          null,
        ]),
      ).map(e => e.id),
    ).toEqual(['a']);
    expect(parseWidgetLogs('not json')).toEqual([]);
  });
});
