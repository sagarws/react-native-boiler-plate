import { storage } from '@/store/mmkv';
import {
  buildArchive,
  FULL_BACKUP_FORMAT,
  parseArchive,
  plannerJson,
  remapUris,
  restoredUris,
  type ArchiveEntry,
  type ReadArchive,
} from '../../services/fullBackup';
import { lifeStore } from '../../store/life.store';
import { spanBetween } from '../services/plannerFormat';
import { plannerReminders, reminderTime } from '../services/plannerReminders';
import { plannerStore } from '../store/planner.store';

jest.mock('@/specs/NativeLifeBackup', () => ({
  __esModule: true,
  default: {
    saveZip: jest.fn(),
    readZip: jest.fn(),
    adoptStaged: jest.fn(),
    discardStaged: jest.fn(),
    saveText: jest.fn(),
    syncPlannerReminders: jest.fn(),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeLifeBackup',
).default;

const PHOTO = 'file:///data/user/0/com.rnboilerplate/files/photo.jpg';

function seed() {
  const lp = lifeStore.createProject({
    name: 'Health',
    icon: 'gauge',
    color: 'emerald',
    startDate: '2026-10-01',
    deadline: '2026-12-31',
  });
  if (!lp.ok) throw new Error(lp.error);
  const task = lifeStore.createTask({
    projectId: lp.value.id,
    name: 'Walk',
    icon: 'gauge',
    color: 'emerald',
    unit: 'steps',
    target: { quantity: 5000, frequency: 'daily', intervalDays: 1 },
    startDate: '2026-10-20',
  });
  if (!task.ok) throw new Error(task.error);
  const p = plannerStore.createProject({
    name: 'Life Vision',
    startDate: '2026-01-01',
    targetDate: '2045-12-31',
    color: 'violet',
  });
  if (!p.ok) throw new Error(p.error);
  const status = plannerStore.addStatus('On hold', 'pink');
  if (!status.ok) throw new Error('status');
  const a = plannerStore.addNode(p.value.rootNodeId, {
    name: 'Business',
    startDate: '2026-01-01',
    targetDate: '2035-12-31',
    statusId: status.value.id,
    categoryId: 'mandatory',
    imageUri: PHOTO,
    link: { type: 'task', id: task.value.id },
  });
  if (!a.ok) throw new Error(a.error);
  const m = plannerStore.addNode(a.value.id, {
    name: 'Launch 2028',
    kind: 'milestone',
    startDate: '2027-01-01',
    targetDate: '2028-06-01',
    statusId: 'pending',
    categoryId: 'optional',
    reminderAt: '2027-12-01T09:30',
  });
  if (!m.ok) throw new Error(m.error);
  plannerStore.addNote(a.value.id, 'First office', null);
  return {
    project: p.value,
    business: a.value,
    milestone: m.value,
    task: task.value,
  };
}

/** What the native reader would hand back for these entries. */
function asRead(
  manifest: object,
  entries: ArchiveEntry[],
  checksumErrors: string[] = [],
): ReadArchive {
  const texts: Record<string, string> = {};
  const files: Record<string, string> = {};
  for (const e of entries) {
    if ('text' in e) texts[e.path] = e.text;
    else files[e.path] = `file:///cache/restore-stage/s1/${e.path}`;
  }
  return {
    stageId: 's1',
    manifest: manifest as Record<string, unknown>,
    texts,
    files,
    checksumErrors,
  };
}

beforeEach(() => {
  storage.clearAll();
  lifeStore.resetCacheForTest();
  plannerStore.resetForTest();
  jest.clearAllMocks();
});

describe('full backup archive', () => {
  it('exports both modules with a manifest and attachments', () => {
    seed();
    const { manifest, entries } = buildArchive(
      lifeStore.read(),
      plannerStore.read(),
      {
        includeAttachments: true,
        appVersion: '0.1.0',
        exportedAt: new Date('2026-11-02T10:00:00Z'),
      },
    );
    expect(manifest).toMatchObject({
      format: FULL_BACKUP_FORMAT,
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-11-02T10:00:00.000Z',
      modules: ['manage-life', 'long-term-planner'],
      attachments: [
        { uri: PHOTO, path: '0-photo.jpg'.replace(/^/, 'attachments/') },
      ],
    });
    const paths = entries.map(e => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'manage-life/projects.json',
        'manage-life/tasks.json',
        'manage-life/reports.json',
        'long-term-planner/projects.json',
        'long-term-planner/nodes.json',
        'long-term-planner/statuses.json',
        'long-term-planner/categories.json',
        'long-term-planner/milestones.json',
        'long-term-planner/notes.json',
        'long-term-planner/settings.json',
        'attachments/0-photo.jpg',
      ]),
    );
    const milestones = JSON.parse(
      (
        entries.find(e => e.path === 'long-term-planner/milestones.json') as {
          text: string;
        }
      ).text,
    );
    expect(milestones[0]).toMatchObject({
      name: 'Launch 2028',
      targetDate: '2028-06-01',
    });
    expect(
      buildArchive(lifeStore.read(), plannerStore.read(), {
        includeAttachments: false,
        appVersion: '1',
        exportedAt: new Date(),
      }).entries.some(e => e.path.startsWith('attachments/')),
    ).toBe(false);
  });

  it('restores everything with ids, hierarchy, notes and custom statuses intact', async () => {
    const { business, milestone } = seed();
    const lifeBefore = lifeStore.read();
    const planBefore = plannerStore.read();
    const { manifest, entries } = buildArchive(lifeBefore, planBefore, {
      includeAttachments: true,
      appVersion: '1',
      exportedAt: new Date(),
    });
    const parsed = parseArchive(
      asRead(JSON.parse(JSON.stringify(manifest)), entries),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.counts).toMatchObject({
      lifeProjects: 1,
      lifeTasks: 1,
      planProjects: 1,
      planNodes: 3,
      milestones: 1,
    });

    storage.clearAll();
    lifeStore.resetCacheForTest();
    plannerStore.resetForTest();
    native.adoptStaged.mockResolvedValue(
      JSON.stringify({
        'file:///cache/restore-stage/s1/attachments/0-photo.jpg':
          'file:///files/restored/s1/attachments/0-photo.jpg',
      }),
    );
    const { fullBackup } = jest.requireActual<
      typeof import('../../services/fullBackup.service')
    >('../../services/fullBackup.service');
    const summary = await fullBackup.apply(
      { parsed: parsed.value, stageId: 's1' },
      'replace',
    );
    expect(summary.attachments).toBe(1);

    const life = lifeStore.read();
    const plan = plannerStore.read();
    expect(life.tasks.map(t => t.id)).toEqual(lifeBefore.tasks.map(t => t.id));
    expect(plan.nodes.map(n => n.id).sort()).toEqual(
      planBefore.nodes.map(n => n.id).sort(),
    );
    expect(plan.nodes.find(n => n.id === milestone.id)!.parentId).toBe(
      business.id,
    );
    const restored = plan.nodes.find(n => n.id === business.id)!;
    expect(restored.imageUri).toBe(
      'file:///files/restored/s1/attachments/0-photo.jpg',
    );
    expect(restored.link).toEqual(
      planBefore.nodes.find(n => n.id === business.id)!.link,
    );
    expect(plan.statuses.some(s => s.name === 'On hold')).toBe(true);
    expect(plan.notes.map(n => n.content)).toEqual(['First office']);
  });

  it('rejects incompatible, corrupt and malformed archives', () => {
    seed();
    const { manifest, entries } = buildArchive(
      lifeStore.read(),
      plannerStore.read(),
      { includeAttachments: false, appVersion: '1', exportedAt: new Date() },
    );
    expect(
      parseArchive(asRead({ ...manifest, schemaVersion: 99 }, entries)),
    ).toEqual({ ok: false, error: 'newer_schema' });
    expect(parseArchive(asRead({ format: 'something-else' }, entries))).toEqual(
      { ok: false, error: 'not_backup' },
    );
    expect(
      parseArchive(asRead(manifest, entries, ['manage-life/tasks.json'])),
    ).toEqual({ ok: false, error: 'corrupt' });
    const broken = entries.map(e =>
      e.path === 'long-term-planner/nodes.json'
        ? { path: e.path, text: '{oops' }
        : e,
    );
    expect(parseArchive(asRead(manifest, broken))).toEqual({
      ok: false,
      error: 'bad_json',
    });
  });

  it('keeps duplicates once and repairs orphaned nodes', () => {
    const { project } = seed();
    const d = plannerStore.read();
    const nodes = [
      ...d.nodes,
      d.nodes[1],
      { ...d.nodes[1], id: 'orphan', parentId: 'gone' },
    ];
    const parsed = parseArchive(
      asRead(
        {
          format: FULL_BACKUP_FORMAT,
          schemaVersion: 1,
          modules: ['long-term-planner'],
        },
        [
          {
            path: 'long-term-planner/projects.json',
            text: JSON.stringify(d.projects),
          },
          { path: 'long-term-planner/nodes.json', text: JSON.stringify(nodes) },
        ],
      ),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.value.duplicates).toBe(1);
    expect(
      parsed.value.planner!.nodes.find(n => n.id === 'orphan')!.parentId,
    ).toBe(project.rootNodeId);
  });

  it('rolls Manage Life back when the planner restore fails', async () => {
    seed();
    const lifeBefore = lifeStore.read();
    const { manifest, entries } = buildArchive(
      lifeStore.read(),
      plannerStore.read(),
      { includeAttachments: false, appVersion: '1', exportedAt: new Date() },
    );
    const parsed = parseArchive(asRead(manifest, entries));
    if (!parsed.ok) throw new Error(parsed.error);
    // Change Manage Life so a rollback is observable.
    const changed = {
      ...parsed.value,
      life: { ...parsed.value.life!, projects: [] },
    };
    const spy = jest.spyOn(plannerStore, 'restore').mockImplementation(() => {
      throw new Error('disk full');
    });
    const { fullBackup } = jest.requireActual<
      typeof import('../../services/fullBackup.service')
    >('../../services/fullBackup.service');
    await expect(
      fullBackup.apply({ parsed: changed, stageId: 's1' }, 'replace'),
    ).rejects.toMatchObject({ code: 'restore_failed' });
    expect(lifeStore.read().projects.map(p => p.id)).toEqual(
      lifeBefore.projects.map(p => p.id),
    );
    spy.mockRestore();
  });

  it('maps restored attachment uris and clears missing ones', () => {
    const map = restoredUris(
      {
        format: '',
        schemaVersion: 1,
        appVersion: '',
        exportedAt: '',
        modules: [],
        includesAttachments: true,
        attachments: [{ uri: 'file:///a.jpg', path: 'attachments/0-a.jpg' }],
      },
      { 'attachments/0-a.jpg': 'file:///stage/a.jpg' },
      { 'file:///stage/a.jpg': 'file:///files/a.jpg' },
    );
    expect(map.get('file:///a.jpg')).toBe('file:///files/a.jpg');
    seed();
    const { manifest, entries } = buildArchive(null, plannerStore.read(), {
      includeAttachments: false,
      appVersion: '1',
      exportedAt: new Date(),
    });
    const parsed = parseArchive(asRead(manifest, entries));
    if (!parsed.ok) throw new Error(parsed.error);
    const out = remapUris(parsed.value, new Map());
    expect(out.planner!.nodes.every(n => n.imageUri === '')).toBe(true);
  });

  it('exports the planner alone as JSON', () => {
    seed();
    const doc = JSON.parse(
      plannerJson(plannerStore.read(), '1', new Date('2026-11-02T00:00:00Z')),
    );
    expect(doc).toMatchObject({
      format: 'akshar-long-term-planner',
      schemaVersion: 1,
    });
    expect(doc.nodes).toHaveLength(3);
  });
});

describe('reminders and dates', () => {
  it('schedules reminders for open goals only, linking to the node', () => {
    const { milestone, project } = seed();
    const now = new Date('2026-11-02T08:00:00').getTime();
    const list = plannerReminders(
      plannerStore.read(),
      now,
      (name, p, target) => ({ title: name, body: `${p} ${target}` }),
    );
    expect(list).toEqual([
      expect.objectContaining({
        key: `plan:${milestone.id}`,
        at: reminderTime('2027-12-01T09:30'),
        title: 'Launch 2028',
        link: `rnboilerplate://planner/${project.id}/${milestone.id}`,
      }),
    ]);
    plannerStore.setNodeStatus(milestone.id, 'completed', '2026-11-02');
    expect(
      plannerReminders(plannerStore.read(), now, () => ({
        title: '',
        body: '',
      })),
    ).toHaveLength(0);
    expect(
      plannerReminders(
        plannerStore.read(),
        reminderTime('2028-01-01T00:00'),
        () => ({ title: '', body: '' }),
      ),
    ).toHaveLength(0);
    expect(reminderTime('bad')).toBeNaN();
  });

  it('measures spans in years, months and days', () => {
    expect(spanBetween('2026-11-02', '2035-01-07')).toEqual({
      years: 8,
      months: 2,
      days: 5,
      past: false,
    });
    expect(spanBetween('2026-11-02', '2026-10-01')).toEqual({
      years: 0,
      months: 1,
      days: 1,
      past: true,
    });
    expect(spanBetween('2026-01-31', '2026-03-01')).toEqual({
      years: 0,
      months: 1,
      days: 1,
      past: false,
    });
  });
});
