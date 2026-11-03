import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { pick } from '@react-native-documents/picker';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { FullBackupSection } from '../../components/FullBackupSection';
import { buildArchive } from '../../services/fullBackup';
import { lifeStore } from '../../store/life.store';
import { PlannerTab } from '../components/PlannerTab';
import PlannerMapScreen from '../screens/PlannerMapScreen';
import PlannerProjectFormScreen from '../screens/PlannerProjectFormScreen';
import { plannerStore } from '../store/planner.store';

let mockParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    replace: mockReplace,
    goBack: jest.fn(),
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('@/specs/NativeLifeBackup', () => ({
  __esModule: true,
  default: {
    saveZip: jest.fn(),
    readZip: jest.fn(),
    adoptStaged: jest.fn(),
    discardStaged: jest.fn(),
    saveText: jest.fn(),
    syncPlannerReminders: jest.fn().mockResolvedValue(0),
    openFile: jest.fn(),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeLifeBackup',
).default;

const TODAY = '2026-11-02';
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
const find = (r: Renderer, id: string) =>
  r.root.findAll(
    n =>
      n.props.testID === id &&
      (typeof n.props.onPress === 'function' ||
        typeof n.props.onChangeText === 'function' ||
        typeof n.props.onChange === 'function'),
  )[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const act = (fn: () => unknown) =>
  ReactTestRenderer.act(async () => {
    await fn();
  });
const press = (r: Renderer, id: string) =>
  act(() => find(r, id).props.onPress());
const type = (r: Renderer, id: string, text: string) =>
  act(() =>
    r.root
      .findAll(
        n =>
          n.props.testID === id && typeof n.props.onChangeText === 'function',
      )[0]
      .props.onChangeText(text),
  );
const later = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });
const texts = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => [n.props.children].flat().join(''))
    .join('\n');

function seedPlan() {
  const p = plannerStore.createProject({
    name: 'Life Vision',
    startDate: '2026-01-01',
    targetDate: '2045-12-31',
    color: 'violet',
  });
  if (!p.ok) throw new Error(p.error);
  const add = (parentId: string, name: string, extra = {}) => {
    const r = plannerStore.addNode(parentId, {
      name,
      startDate: '2026-01-01',
      targetDate: '2040-12-31',
      statusId: 'pending',
      categoryId: 'mandatory',
      ...extra,
    });
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const business = add(p.value.rootNodeId, 'Business');
  const company = add(business.id, 'Establish Company');
  const team = add(company.id, 'Build Team');
  const health = add(p.value.rootNodeId, 'Health');
  return { project: p.value, business, company, team, health };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(`${TODAY}T09:00:00`));
  storage.clearAll();
  lifeStore.resetCacheForTest();
  plannerStore.resetForTest();
  jest.clearAllMocks();
  mockParams = undefined;
});
afterEach(() => {
  ReactTestRenderer.act(() => mounted.splice(0).forEach(r => r.unmount()));
  jest.useRealTimers();
});

describe('Long-Term Planner tab and project form', () => {
  it('shows the empty state and opens the create form', async () => {
    const r = await render(<PlannerTab today={TODAY} />);
    expect(has(r, 'planner-empty')).toBe(true);
    await press(r, 'planner-create');
    expect(mockNavigate).toHaveBeenCalledWith('PlannerProjectForm', {});
  });

  it('creates a 20-year project from a template and opens its map', async () => {
    mockParams = {};
    const r = await render(<PlannerProjectFormScreen />);
    await type(r, 'plan-name', 'Life Vision 2026–2046');
    await act(() => find(r, 'plan-template-vision').props.onPress());
    await press(r, 'plan-save');
    const p = plannerStore.read().projects[0];
    expect(p).toMatchObject({
      name: 'Life Vision 2026–2046',
      targetDate: '2046-12-31',
      targetEstimated: true,
    });
    expect(
      plannerStore.read().nodes.filter(n => n.projectId === p.id).length,
    ).toBeGreaterThan(8);
    expect(mockReplace).toHaveBeenCalledWith('PlannerMap', { projectId: p.id });
    const tab = await render(<PlannerTab today={TODAY} />);
    expect(has(tab, `plan-${p.id}`)).toBe(true);
  });
});

describe('mind map', () => {
  it('renders every node and selects, then opens details on a second tap', async () => {
    const { project, business, team } = seedPlan();
    mockParams = { projectId: project.id };
    const r = await render(<PlannerMapScreen />);
    expect(has(r, `node-${team.id}`)).toBe(true);
    await press(r, `node-${business.id}`);
    expect(has(r, 'selection-bar')).toBe(true);
    await later(500);
    await press(r, `node-${business.id}`);
    expect(has(r, 'node-detail')).toBe(true);
    expect(texts(r)).toContain('Business');
  });

  it('adds a child, warning about dates outside the parent', async () => {
    const { project, health } = seedPlan();
    mockParams = { projectId: project.id };
    const alert = jest.spyOn(Alert, 'alert');
    const r = await render(<PlannerMapScreen />);
    await press(r, `node-${health.id}`);
    await press(r, 'selection-add');
    await type(r, 'node-name', 'Marathon');
    await press(r, 'node-save');
    expect(
      plannerStore
        .read()
        .nodes.some(n => n.name === 'Marathon' && n.parentId === health.id),
    ).toBe(true);

    // A child ending after its parent asks first.
    plannerStore.updateNode(health.id, {
      name: 'Health',
      startDate: '2026-01-01',
      targetDate: '2026-12-31',
      statusId: 'pending',
      categoryId: 'mandatory',
    });
    // Saving selected the new node; go back to Health.
    await later(500);
    await press(r, `node-${health.id}`);
    await press(r, 'selection-add');
    await type(r, 'node-name', 'Late goal');
    // Defaults stay inside the parent; pick a target after its end.
    await act(() => find(r, 'node-target').props.onChange('2030-01-01'));
    await press(r, 'node-save');
    expect(alert).toHaveBeenCalled();
    const keep = alert.mock.calls[alert.mock.calls.length - 1][2]!.find(
      b => b.style !== 'cancel',
    )!;
    await act(() => keep.onPress!());
    expect(
      plannerStore.read().nodes.find(n => n.name === 'Late goal'),
    ).toMatchObject({ rangeConfirmed: true });
  });

  it('saves a custom status and category from "Other"', async () => {
    const { project, health } = seedPlan();
    mockParams = { projectId: project.id };
    const r = await render(<PlannerMapScreen />);
    await press(r, `node-${health.id}`);
    await press(r, 'selection-add');
    await type(r, 'node-name', 'Sleep');
    await press(r, 'node-status-__other__');
    await type(r, 'node-custom-status', 'On hold');
    await press(r, 'node-category-__other__');
    await type(r, 'node-custom-category', 'Stretch');
    await press(r, 'node-save');
    const d = plannerStore.read();
    const node = d.nodes.find(n => n.name === 'Sleep')!;
    expect(d.statuses.find(s => s.id === node.statusId)!.name).toBe('On hold');
    expect(d.categories.find(c => c.id === node.categoryId)!.name).toBe(
      'Stretch',
    );
  });

  it('double tap collapses and expands a branch', async () => {
    const { project, business, company } = seedPlan();
    mockParams = { projectId: project.id };
    const r = await render(<PlannerMapScreen />);
    await press(r, `node-${business.id}`);
    await press(r, `node-${business.id}`);
    expect(has(r, `node-${company.id}`)).toBe(false);
    await later(500);
    await press(r, `node-${business.id}`);
    await press(r, `node-${business.id}`);
    expect(has(r, `node-${company.id}`)).toBe(true);
  });

  it('moves a node only to valid parents, deletes keeping children, and undoes', async () => {
    const { project, business, company, team, health } = seedPlan();
    mockParams = { projectId: project.id };
    const alert = jest.spyOn(Alert, 'alert');
    const r = await render(<PlannerMapScreen />);
    await act(() => find(r, `node-${business.id}`).props.onLongPress());
    await press(r, 'node-menu-move');
    expect(has(r, `move-to-${company.id}`)).toBe(false); // its own branch
    expect(has(r, `move-to-${team.id}`)).toBe(false);
    await press(r, `move-to-${health.id}`);
    expect(
      plannerStore.read().nodes.find(n => n.id === business.id)!.parentId,
    ).toBe(health.id);

    await act(() => find(r, `node-${company.id}`).props.onLongPress());
    await press(r, 'node-menu-delete');
    const keep = alert.mock.calls[alert.mock.calls.length - 1][2]!.find(
      b => b.text === 'Keep sub-goals',
    )!;
    await act(() => keep.onPress!());
    const d = plannerStore.read();
    expect(d.nodes.some(n => n.id === company.id)).toBe(false);
    expect(d.nodes.find(n => n.id === team.id)!.parentId).toBe(business.id);

    await press(r, 'map-tool-undo');
    expect(plannerStore.read().nodes.some(n => n.id === company.id)).toBe(true);
  });

  it('switches between all four styles without changing the data', async () => {
    const { project } = seedPlan();
    mockParams = { projectId: project.id };
    const before = JSON.stringify(plannerStore.read().nodes);
    const r = await render(<PlannerMapScreen />);
    for (const style of ['roadmap', 'radial', 'timeline', 'tree']) {
      await press(r, 'map-tool-style');
      await press(r, `map-style-${style}`);
      await later(200);
      expect(plannerStore.read().projects[0].preferredStyle).toBe(style);
      expect(has(r, 'mind-map')).toBe(true);
    }
    expect(JSON.stringify(plannerStore.read().nodes)).toBe(before);
  });

  it('search reveals a node inside a collapsed branch and highlights it', async () => {
    const { project, business, team } = seedPlan();
    plannerStore.setCollapsed(business.id, true);
    mockParams = { projectId: project.id };
    const r = await render(<PlannerMapScreen />);
    expect(has(r, `node-${team.id}`)).toBe(false);
    await press(r, 'map-tool-search');
    await type(r, 'node-search-input', 'team');
    await press(r, `search-hit-${team.id}`);
    expect(has(r, `node-${team.id}`)).toBe(true);
    expect(
      plannerStore.read().nodes.find(n => n.id === business.id)!.collapsed,
    ).toBe(false);
    expect(has(r, 'selection-bar')).toBe(true);
  });
});

describe('full backup section', () => {
  it('exports one ZIP with both modules and restores a preview by merging', async () => {
    seedPlan();
    native.saveZip.mockResolvedValue(true);
    const r = await render(<FullBackupSection />);
    await press(r, 'zip-export');
    const [fileName, manifestJson, entriesJson] = native.saveZip.mock.calls[0];
    expect(fileName).toBe('ManageLife_Backup_2026-11-02.zip');
    expect(JSON.parse(manifestJson).modules).toEqual([
      'manage-life',
      'long-term-planner',
    ]);
    expect(
      JSON.parse(entriesJson).map((e: { path: string }) => e.path),
    ).toContain('long-term-planner/nodes.json');

    // Restore that backup into an empty app.
    const { manifest, entries } = buildArchive(
      lifeStore.read(),
      plannerStore.read(),
      { includeAttachments: false, appVersion: '1', exportedAt: new Date() },
    );
    storage.clearAll();
    plannerStore.resetForTest();
    lifeStore.resetCacheForTest();
    const textsMap: Record<string, string> = {};
    for (const e of entries) if ('text' in e) textsMap[e.path] = e.text;
    native.readZip.mockResolvedValue(
      JSON.stringify({
        stageId: '00000000-0000-0000-0000-000000000000',
        manifest,
        texts: textsMap,
        files: {},
        checksumErrors: [],
      }),
    );
    (pick as jest.Mock).mockResolvedValue([
      {
        uri: 'content://backup.zip',
        name: 'backup.zip',
        type: 'application/zip',
      },
    ]);
    await press(r, 'zip-import');
    expect(has(r, 'zip-review')).toBe(true);
    expect(texts(r)).toContain('1 plans · 5 nodes');
    await press(r, 'zip-merge');
    expect(plannerStore.read().nodes).toHaveLength(5);
    expect(has(r, 'zip-message')).toBe(true);
  });
});
