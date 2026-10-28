import { storage } from '@/store/mmkv';
import { lifeStore } from '../store/life.store';
import {
  buildPayload,
  historySize,
  localInsights,
  MIN_HISTORY,
  parseRecommendations,
} from '../services/recommendations';
import { parseLifeCoachReply } from '@/features/capture/services/lifeCoach.service';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: null,
}));

const TODAY = '2026-10-28';

function seed() {
  jest.setSystemTime(new Date('2026-10-14T09:00:00'));
  const p = lifeStore.createProject({
    name: 'Learn',
    icon: 'bookOpen',
    color: 'violet',
    startDate: '2026-10-14',
    deadline: '2026-12-31',
  });
  if (!p.ok) throw new Error();
  const t = lifeStore.createTask({
    projectId: p.value.id,
    name: 'Read',
    icon: 'bookOpen',
    color: 'violet',
    unit: 'minutes',
    target: { quantity: 30, frequency: 'daily', intervalDays: 1 },
    startDate: '2026-10-14',
  });
  if (!t.ok) throw new Error();
  jest.setSystemTime(new Date('2026-10-28T09:00:00'));
  // Met on 4 days, short with reasons on others.
  for (const day of ['2026-10-20', '2026-10-21', '2026-10-24', '2026-10-25']) {
    lifeStore.addReport(
      {
        taskId: t.value.id,
        day,
        quantity: 30,
        note: day === '2026-10-24' ? 'Long weekend session' : '',
      },
      TODAY,
    );
  }
  for (const day of ['2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27']) {
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
  return t.value;
}

beforeEach(() => {
  jest.useFakeTimers();
  storage.clearAll();
  lifeStore.resetCacheForTest();
});
afterEach(() => jest.useRealTimers());

describe('AI input', () => {
  it('sends only the user’s own task history — no ids or keys', () => {
    const task = seed();
    const data = lifeStore.read();
    expect(historySize(data, TODAY)).toBeGreaterThanOrEqual(MIN_HISTORY);
    const payload = buildPayload(data, TODAY);
    const json = JSON.parse(payload);
    expect(json.tasks[0]).toMatchObject({
      taskName: 'Read',
      unit: 'minutes',
      currentTarget: { quantity: 30, frequency: 'daily' },
    });
    expect(
      json.tasks[0].periods.some(
        (p: { reason?: string }) => p.reason === 'unexpected_tasks',
      ),
    ).toBe(true);
    expect(json.tasks[0].notes).toContainEqual({
      day: '2026-10-24',
      note: 'Long weekend session',
    });
    expect(payload).not.toContain(task.id);
    expect(json.reasonCounts[0]).toEqual({
      reason: 'unexpected_tasks',
      count: 4,
    });
  });

  it('needs enough history before asking Gemini', () => {
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    const p = lifeStore.createProject({
      name: 'New',
      icon: 'layers',
      color: 'violet',
      startDate: TODAY,
      deadline: '2026-11-30',
    });
    if (p.ok) {
      lifeStore.createTask({
        projectId: p.value.id,
        name: 'Fresh',
        icon: 'layers',
        color: 'violet',
        unit: 'pages',
        target: { quantity: 10, frequency: 'daily', intervalDays: 1 },
        startDate: TODAY,
      });
    }
    expect(historySize(lifeStore.read(), TODAY)).toBeLessThan(MIN_HISTORY);
  });
});

describe('AI reply validation', () => {
  it('accepts a valid structured reply and maps task names to tasks', () => {
    const task = seed();
    const set = parseRecommendations(
      JSON.stringify({
        summary: 'Reading is on track 4 of 8 days.',
        recommendations: [
          {
            category: 'adjustment',
            title: 'Lower the weekday target',
            explanation: 'You met the target on 4 of the last 8 days.',
            evidence: '22–27 Oct: reason "unexpected tasks" 4 times',
            action: 'Try 20 minutes on weekdays.',
            priority: 'high',
            taskName: 'read',
            proposedTarget: {
              quantity: 20,
              frequency: 'daily',
              intervalDays: 1,
            },
          },
          {
            category: 'positive',
            title: 'Weekend sessions work',
            explanation: '',
            evidence: '',
            action: '',
            priority: 'low',
          },
        ],
      }),
      lifeStore.read(),
      7,
    )!;
    expect(set.dataVersion).toBe(7);
    expect(set.items[0]).toMatchObject({
      taskId: task.id,
      proposedTarget: { quantity: 20, frequency: 'daily', intervalDays: 1 },
    });
    expect(set.items[1].proposedTarget).toBeNull();
  });

  it('drops malformed replies, unknown tasks’ proposals and invalid targets', () => {
    seed();
    const data = lifeStore.read();
    expect(parseRecommendations('not json', data, 1)).toBeNull();
    expect(
      parseRecommendations('{"recommendations": "nope"}', data, 1),
    ).toBeNull();
    const set = parseRecommendations(
      JSON.stringify({
        summary: 's',
        recommendations: [
          { category: 'hack', title: 'Delete everything', action: 'x' },
          {
            category: 'adjustment',
            title: 'Ghost',
            taskName: 'Unknown task',
            proposedTarget: {
              quantity: 5,
              frequency: 'daily',
              intervalDays: 1,
            },
          },
          {
            category: 'adjustment',
            title: 'Zero',
            taskName: 'Read',
            proposedTarget: {
              quantity: 0,
              frequency: 'daily',
              intervalDays: 1,
            },
          },
          {
            category: 'adjustment',
            title: 'Same',
            taskName: 'Read',
            proposedTarget: {
              quantity: 30,
              frequency: 'daily',
              intervalDays: 1,
            },
          },
        ],
      }),
      data,
      1,
    )!;
    expect(set.items.map(i => i.title)).toEqual(['Ghost', 'Zero', 'Same']);
    expect(set.items.every(i => i.proposedTarget === null)).toBe(true);
  });

  it('maps native errors (network, timeout, rate limit) to outcomes', () => {
    expect(
      parseLifeCoachReply(JSON.stringify({ outcome: 'timeout' })).outcome,
    ).toBe('timeout');
    expect(
      parseLifeCoachReply(JSON.stringify({ outcome: 'quota', status: 429 })),
    ).toMatchObject({ outcome: 'quota', status: 429 });
    expect(
      parseLifeCoachReply(JSON.stringify({ outcome: 'no_internet' })).outcome,
    ).toBe('no_internet');
    expect(parseLifeCoachReply('garbage').outcome).toBe('bad_response');
  });
});

describe('rule-based insights', () => {
  it('reports repeated blockers and realism from real records only', () => {
    seed();
    const insights = localInsights(lifeStore.read(), TODAY);
    expect(insights).toContainEqual(
      expect.objectContaining({
        kind: 'blocker',
        values: { reason: 'unexpected_tasks', count: 4 },
      }),
    );
    // Oct 14–19 have no reports (unmet), so 4 of 14 periods were met.
    expect(insights).toContainEqual(
      expect.objectContaining({
        kind: 'realism',
        values: expect.objectContaining({ met: 4, total: 14, pct: 29 }),
      }),
    );
  });

  it('suggests getting started when there are no tasks', () => {
    expect(localInsights(lifeStore.read(), TODAY)).toEqual([
      { kind: 'start', taskId: null, values: {} },
    ]);
  });
});

describe('localInsights before any period ends', () => {
  it('explains what to expect instead of showing nothing', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-28T09:00:00'));
    const p = lifeStore.createProject({
      name: 'New',
      icon: 'layers',
      color: 'violet',
      startDate: '2026-10-28',
      deadline: '2026-12-31',
    });
    if (!p.ok) throw new Error();
    lifeStore.createTask({
      projectId: p.value.id,
      name: 'Walk',
      icon: 'layers',
      color: 'violet',
      unit: 'steps',
      target: { quantity: 4400, frequency: 'daily', intervalDays: 1 },
      startDate: '2026-10-28',
    });
    expect(
      localInsights(lifeStore.read(), '2026-10-28').map(i => i.kind),
    ).toEqual(['early']);
    jest.useRealTimers();
  });
});
