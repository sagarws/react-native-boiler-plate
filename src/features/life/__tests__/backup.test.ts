import { storage } from '@/store/mmkv';
import {
  backupFileName,
  fromSheets,
  readTable,
  SHEETS,
  toDayKey,
  toSheets,
  type SheetData,
} from '../services/backup';
import { lifeStore, type BackupInput } from '../store/life.store';

const TODAY = '2026-10-28';

/** One project, two tasks (one with a target change and a pause), progress with an edit, a review. */
function seed() {
  jest.setSystemTime(new Date('2026-10-14T09:00:00'));
  const p = lifeStore.createProject({
    name: 'Health & "Fitness"',
    icon: 'gauge',
    color: 'emerald',
    startDate: '2026-10-01',
    deadline: '2026-12-31',
    description: 'Line one\nline two',
  });
  if (!p.ok) throw new Error(p.error);
  const walk = lifeStore.createTask({
    projectId: p.value.id,
    name: 'Walk',
    icon: 'gauge',
    color: 'emerald',
    unit: 'steps',
    target: { quantity: 5000, frequency: 'daily', intervalDays: 1 },
    startDate: '2026-10-20',
  });
  const read = lifeStore.createTask({
    projectId: p.value.id,
    name: 'वाचन',
    icon: 'bookOpen',
    color: 'violet',
    unit: 'pages',
    target: { quantity: 3, frequency: 'interval', intervalDays: 3 },
    startDate: '2026-10-20',
    endDate: '2026-11-30',
  });
  if (!walk.ok || !read.ok) throw new Error('task');
  jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
  lifeStore.changeTarget(
    walk.value.id,
    { quantity: 6000, frequency: 'weekly', intervalDays: 7 },
    TODAY,
  );
  lifeStore.pauseTask(read.value.id, 'Travel', TODAY);
  const r = lifeStore.addReport(
    { taskId: walk.value.id, day: '2026-10-21', quantity: 4000, note: 'Park' },
    TODAY,
  );
  if (!r.ok) throw new Error('report');
  lifeStore.editReport(r.value.id, { quantity: 4500, note: 'Park, longer' });
  lifeStore.addReview(
    {
      taskId: walk.value.id,
      periodStart: '2026-10-21',
      reason: 'other',
      note: 'Rain',
    },
    TODAY,
  );
  return lifeStore.read();
}

const strip = <T extends { imageUri?: string }>(x: T) => ({
  ...x,
  imageUri: '',
});

beforeEach(() => {
  jest.useFakeTimers();
  storage.clearAll();
  lifeStore.resetCacheForTest();
});
afterEach(() => jest.useRealTimers());

describe('export sheets', () => {
  it('has an About sheet and one sheet per record type', () => {
    const sheets = toSheets(seed(), new Date('2026-10-28T10:00:00Z'));
    expect(sheets.map(s => s.name)).toEqual([
      'About',
      'Projects',
      'Tasks',
      'Targets',
      'Pauses',
      'Progress',
      'Progress edits',
      'Reviews',
    ]);
    const about = new Map(sheets[0].rows.map(r => [r[0], r[1]]));
    expect(about.get('format')).toBe('akshar-life-backup');
    expect(about.get('projects')).toBe(1);
    // Readable helper columns.
    const progress = readTable(sheets, SHEETS.progress)[0];
    expect(progress).toMatchObject({ task: 'Walk', unit: 'steps' });
    expect(readTable(sheets, SHEETS.targets)).toHaveLength(3);
  });

  it('names the file by date', () => {
    expect(backupFileName(new Date(2026, 10, 2))).toBe(
      'akshar-manage-life-2026-11-02.xlsx',
    );
  });
});

describe('import', () => {
  it('restores an export exactly (pictures aside)', () => {
    const before = seed();
    const sheets = toSheets(before, new Date());
    const parsed = fromSheets(JSON.parse(JSON.stringify(sheets)));
    if (!parsed.ok) throw new Error(parsed.error);

    storage.clearAll();
    lifeStore.resetCacheForTest();
    const summary = lifeStore.restore(parsed.input, 'replace');
    const after = lifeStore.read();

    expect(summary).toMatchObject({
      projects: 1,
      tasks: 2,
      reports: 1,
      reviews: 1,
      skipped: 0,
    });
    expect(after.projects).toEqual(before.projects.map(strip));
    expect(after.tasks).toEqual(before.tasks.map(strip));
    expect(after.reports).toEqual(before.reports);
    expect(after.reviews).toEqual(before.reviews);
  });

  it('reads a sheet edited in Excel: date serials, text numbers, other column order', () => {
    const sheets: SheetData[] = [
      {
        name: 'projects',
        rows: [
          ['name', 'id', 'startDate', 'deadline', 'createdAt', 'updatedAt'],
          [
            'Edited',
            'p1',
            46315,
            '31/12/2026',
            46315.5,
            '2026-10-28T09:00:00.000Z',
          ],
        ],
      },
      {
        name: 'Tasks',
        rows: [
          ['id', 'projectId', 'name', 'unit', 'startDate', 'endDate'],
          ['t1', 'p1', 'Run', 'km', '2026-10-20', null],
        ],
      },
      {
        name: 'Targets',
        rows: [
          ['taskId', 'effectiveFrom', 'quantity', 'frequency', 'intervalDays'],
          ['t1', '2026-10-20', '2,5', 'daily', 1],
        ],
      },
      {
        name: 'Progress',
        rows: [
          ['id', 'taskId', 'day', 'quantity'],
          [101, 't1', 46316, 3],
          [null, null, null, null],
        ],
      },
    ];
    const parsed = fromSheets(sheets);
    if (!parsed.ok) throw new Error(parsed.error);
    lifeStore.restore(parsed.input, 'replace');
    const d = lifeStore.read();
    expect(d.projects[0]).toMatchObject({
      id: 'p1',
      startDate: '2026-10-20',
      deadline: '2026-12-31',
      createdAt: '2026-10-20T12:00:00.000Z',
    });
    expect(d.tasks[0].targets[0].quantity).toBe(2.5);
    expect(d.tasks[0].endDate).toBeNull();
    expect(d.reports[0]).toMatchObject({ id: '101', day: '2026-10-21' });
  });

  it('rejects workbooks that are not backups, or from a newer format', () => {
    expect(fromSheets([{ name: 'Sheet1', rows: [['a'], [1]] }])).toEqual({
      ok: false,
      error: 'not_backup',
    });
    expect(
      fromSheets([
        {
          name: 'About',
          rows: [
            ['field', 'value'],
            ['format', 'akshar-life-backup'],
            ['formatVersion', 99],
          ],
        },
      ]),
    ).toEqual({ ok: false, error: 'newer_format' });
  });

  it('converts dates', () => {
    expect(toDayKey(46315)).toBe('2026-10-20');
    expect(toDayKey('2026-10-20T00:00:00Z')).toBe('2026-10-20');
    expect(toDayKey('5/1/2026')).toBe('2026-01-05');
    expect(toDayKey('')).toBeNull();
    expect(toDayKey('soon')).toBeNull();
  });
});

describe('restore modes', () => {
  const project = (id: string, name: string, updatedAt: string) => ({
    id,
    name,
    startDate: '2026-10-01',
    deadline: '2026-12-31',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt,
  });
  const input = (over: Partial<BackupInput>): BackupInput => ({
    projects: [],
    tasks: [],
    reports: [],
    reviews: [],
    ...over,
  });

  it('merge adds new records, keeps newer local ones and never deletes', () => {
    lifeStore.restore(
      input({
        projects: [
          project('a', 'Local A', '2026-10-10T00:00:00.000Z'),
          project('b', 'Local B', '2026-10-20T00:00:00.000Z'),
        ],
      }),
      'replace',
    );
    const summary = lifeStore.restore(
      input({
        projects: [
          project('a', 'Backup A (newer)', '2026-10-15T00:00:00.000Z'),
          project('b', 'Backup B (older)', '2026-10-01T00:00:00.000Z'),
          project('c', 'Backup C', '2026-10-01T00:00:00.000Z'),
        ],
      }),
      'merge',
    );
    const names = lifeStore
      .read()
      .projects.map(p => p.name)
      .sort();
    expect(names).toEqual(['Backup A (newer)', 'Backup C', 'Local B']);
    expect(summary).toMatchObject({ added: 1, updated: 1, projects: 3 });
  });

  it('replace swaps everything and skips orphans and invalid rows', () => {
    seed();
    const summary = lifeStore.restore(
      input({
        projects: [project('p', 'Only', '2026-10-01T00:00:00.000Z')],
        tasks: [
          {
            id: 'orphan',
            projectId: 'missing',
            name: 'X',
            startDate: '2026-10-01',
            targets: [
              { effectiveFrom: '2026-10-01', quantity: 1, frequency: 'daily' },
            ],
          },
        ],
        reports: [{ id: 'bad' }],
      }),
      'replace',
    );
    const d = lifeStore.read();
    expect(d.projects.map(p => p.name)).toEqual(['Only']);
    expect(d.tasks).toHaveLength(0);
    expect(d.reports).toHaveLength(0);
    expect(d.recommendations).toBeNull();
    expect(summary.skipped).toBe(2);
  });
});
