import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { pick } from '@react-native-documents/picker';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { BackupSheet } from '../components/BackupSheet';
import { toSheets } from '../services/backup';
import { lifeStore } from '../store/life.store';

jest.mock('@/specs/NativeLifeBackup', () => ({
  __esModule: true,
  default: { saveWorkbook: jest.fn(), readWorkbook: jest.fn() },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeLifeBackup',
).default;

type Renderer = ReactTestRenderer.ReactTestRenderer;
let renderer: Renderer | undefined;
async function render() {
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <BackupSheet visible onClose={jest.fn()} />,
    );
  });
  return renderer!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const press = (r: Renderer, id: string) =>
  ReactTestRenderer.act(async () => {
    await byId(r, id).props.onPress();
  });
const texts = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => [n.props.children].flat().join(''))
    .join('\n');

function makeProject(name: string) {
  const p = lifeStore.createProject({
    name,
    icon: 'gauge',
    color: 'emerald',
    startDate: '2026-10-01',
    deadline: '2026-12-31',
  });
  if (!p.ok) throw new Error(p.error);
  return p.value;
}

/** A backup file with one project, as the native reader would return it. */
function backupJson(projectName: string) {
  storage.clearAll();
  lifeStore.resetCacheForTest();
  makeProject(projectName);
  const json = JSON.stringify(toSheets(lifeStore.read(), new Date()));
  storage.clearAll();
  lifeStore.resetCacheForTest();
  return json;
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.clearAll();
  lifeStore.resetCacheForTest();
  (pick as jest.Mock).mockResolvedValue([
    { uri: 'content://backup', name: 'backup.xlsx', type: 'x' },
  ]);
});
afterEach(() => {
  ReactTestRenderer.act(() => renderer?.unmount());
});

describe('BackupSheet', () => {
  it('exports every project to a dated .xlsx', async () => {
    makeProject('Learn');
    native.saveWorkbook.mockResolvedValue(true);
    const r = await render();
    await press(r, 'backup-export');
    const [fileName, json] = native.saveWorkbook.mock.calls[0];
    expect(fileName).toMatch(/^akshar-manage-life-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(json).toContain('Learn');
    expect(texts(r)).toContain('Backup saved.');
  });

  it('shows what a backup holds, then merges it without deleting', async () => {
    native.readWorkbook.mockResolvedValue(backupJson('From backup'));
    makeProject('Mine');
    const r = await render();
    await press(r, 'backup-import');
    expect(native.readWorkbook).toHaveBeenCalledWith('file:///copy.jpg');
    expect(has(r, 'backup-review')).toBe(true);
    expect(texts(r)).toContain('1 projects');
    // Nothing changes before a choice.
    expect(lifeStore.read().projects.map(p => p.name)).toEqual(['Mine']);
    await press(r, 'backup-merge');
    expect(
      lifeStore
        .read()
        .projects.map(p => p.name)
        .sort(),
    ).toEqual(['From backup', 'Mine']);
    expect(texts(r)).toContain('Backup merged');
  });

  it('replaces all data only after confirmation', async () => {
    native.readWorkbook.mockResolvedValue(backupJson('From backup'));
    makeProject('Mine');
    const alert = jest.spyOn(Alert, 'alert');
    const r = await render();
    await press(r, 'backup-import');
    await press(r, 'backup-replace');
    expect(lifeStore.read().projects.map(p => p.name)).toEqual(['Mine']);
    const buttons = alert.mock.calls[0][2]!;
    await ReactTestRenderer.act(async () => {
      buttons.find(b => b.style === 'destructive')!.onPress!();
    });
    expect(lifeStore.read().projects.map(p => p.name)).toEqual(['From backup']);
  });

  it('explains a file that is not a backup', async () => {
    native.readWorkbook.mockRejectedValue({ code: 'not_xlsx' });
    const r = await render();
    await press(r, 'backup-import');
    expect(texts(r)).toContain('isn’t an Excel (.xlsx) workbook');
  });

  it('does nothing when the picker is cancelled', async () => {
    (pick as jest.Mock).mockResolvedValue([]);
    const r = await render();
    await press(r, 'backup-import');
    expect(native.readWorkbook).not.toHaveBeenCalled();
    expect(has(r, 'backup-review')).toBe(false);
  });
});
