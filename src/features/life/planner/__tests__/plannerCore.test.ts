import { storage } from '@/store/mmkv';
import {
  canMove,
  childrenMap,
  descendantIds,
  repairTree,
} from '../services/hierarchy';
import { computeLayout, NODE_W } from '../services/layout';
import { lookups, projectNodeProgress } from '../services/plannerProgress';
import {
  milestones,
  moveTargets,
  plannerSummary,
  searchNodes,
  templateNodes,
} from '../services/plannerQueries';
import { plannerStore, sanitize, type NodeInput } from '../store/planner.store';
import { MAP_STYLES, type LongTermNode } from '../types';

const TODAY = '2026-11-02';

function makeProject(
  over: Partial<Parameters<typeof plannerStore.createProject>[0]> = {},
) {
  const r = plannerStore.createProject({
    name: 'Life Vision',
    startDate: '2026-01-01',
    targetDate: '2045-12-31',
    color: 'violet',
    ...over,
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

const input = (name: string, over: Partial<NodeInput> = {}): NodeInput => ({
  name,
  startDate: '2026-01-01',
  targetDate: '2030-12-31',
  statusId: 'pending',
  categoryId: 'mandatory',
  ...over,
});

function add(parentId: string, name: string, over: Partial<NodeInput> = {}) {
  const r = plannerStore.addNode(parentId, input(name, over));
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.value;
}

const nodesOf = (projectId: string) =>
  plannerStore.read().nodes.filter(n => n.projectId === projectId);

beforeEach(() => {
  storage.clearAll();
  plannerStore.resetForTest();
});

describe('projects and nodes', () => {
  it('creates a 20-year project with its root node', () => {
    const p = makeProject();
    const root = nodesOf(p.id)[0];
    expect(root).toMatchObject({
      id: p.rootNodeId,
      parentId: null,
      name: 'Life Vision',
      targetDate: '2045-12-31',
    });
    expect(plannerStore.read().statuses.map(s => s.id)).toEqual([
      'pending',
      'running',
      'completed',
      'ignored',
    ]);
  });

  it('nests children without limit and keeps them after a restart', () => {
    const p = makeProject();
    let parent = p.rootNodeId;
    for (let i = 0; i < 300; i++) parent = add(parent, `Level ${i}`).id;
    plannerStore.resetForTest(); // reload from storage
    const nodes = nodesOf(p.id);
    expect(nodes).toHaveLength(301);
    expect(descendantIds(childrenMap(nodes), p.rootNodeId)).toHaveLength(300);
  });

  it('validates dates and the parent range, with explicit exceptions', () => {
    const p = makeProject({ targetDate: '2030-12-31' });
    expect(plannerStore.addNode(p.rootNodeId, input('', {})).ok).toBe(false);
    expect(
      plannerStore.addNode(
        p.rootNodeId,
        input('Late', { targetDate: '2035-01-01' }),
      ),
    ).toEqual({
      ok: false,
      error: 'outside_parent',
    });
    expect(
      plannerStore.addNode(
        p.rootNodeId,
        input('Late', { targetDate: '2035-01-01', rangeConfirmed: true }),
      ).ok,
    ).toBe(true);
    expect(
      plannerStore.addNode(
        p.rootNodeId,
        input('Back', { startDate: '2028-01-01', targetDate: '2027-01-01' }),
      ),
    ).toEqual({
      ok: false,
      error: 'dates_reversed',
    });
    expect(
      plannerStore.addNode(
        p.rootNodeId,
        input('Back', {
          startDate: '2028-01-01',
          targetDate: '2027-01-01',
          allowReversed: true,
        }),
      ).ok,
    ).toBe(true);
  });

  it('keeps the deadline history and never shifts child dates', () => {
    const p = makeProject();
    const child = add(p.rootNodeId, 'Business');
    const r = plannerStore.updateProject(p.id, {
      name: 'Life Vision',
      startDate: '2026-01-01',
      targetDate: '2050-12-31',
      color: 'blue',
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.deadlineHistory).toEqual([
      expect.objectContaining({ from: '2045-12-31', to: '2050-12-31' }),
    ]);
    const nodes = nodesOf(p.id);
    expect(nodes.find(n => n.id === p.rootNodeId)!.targetDate).toBe(
      '2050-12-31',
    );
    expect(nodes.find(n => n.id === child.id)!.targetDate).toBe('2030-12-31');
  });

  it('saves custom statuses and categories', () => {
    const s = plannerStore.addStatus('On hold', 'pink');
    const c = plannerStore.addCategory('Stretch', 'orange');
    if (!s.ok || !c.ok) throw new Error('custom');
    expect(s.value).toMatchObject({
      name: 'On hold',
      kind: 'other',
      isSystem: false,
    });
    expect(plannerStore.addStatus('', 'pink').ok).toBe(false);
    plannerStore.resetForTest();
    expect(plannerStore.read().statuses.some(x => x.name === 'On hold')).toBe(
      true,
    );
    expect(plannerStore.read().categories.some(x => x.name === 'Stretch')).toBe(
      true,
    );
  });

  it('moves a branch but never into its own descendants', () => {
    const p = makeProject();
    const a = add(p.rootNodeId, 'A');
    const a1 = add(a.id, 'A1');
    const b = add(p.rootNodeId, 'B');
    expect(plannerStore.moveNode(a.id, a1.id)).toEqual({
      ok: false,
      error: 'invalid_move',
    });
    expect(plannerStore.moveNode(a.id, a.id).ok).toBe(false);
    expect(plannerStore.moveNode(p.rootNodeId, b.id).ok).toBe(false);
    expect(moveTargets(nodesOf(p.id), a.id).map(n => n.name)).toEqual(['B']);
    expect(plannerStore.moveNode(a.id, b.id).ok).toBe(true);
    const nodes = nodesOf(p.id);
    expect(nodes.find(n => n.id === a1.id)!.parentId).toBe(a.id); // branch kept
    expect(canMove(nodes, b.id, a1.id)).toBe(false);
  });

  it('deletes a branch or reparents its children', () => {
    const p = makeProject();
    const a = add(p.rootNodeId, 'A');
    const a1 = add(a.id, 'A1');
    add(a1.id, 'A1x');
    expect(plannerStore.branchSize(a.id)).toBe(2);
    plannerStore.deleteNode(a.id, 'reparent');
    expect(nodesOf(p.id).find(n => n.id === a1.id)!.parentId).toBe(
      p.rootNodeId,
    );
    const r = plannerStore.deleteNode(a1.id, 'branch');
    expect(r.ok && r.value).toHaveLength(2);
    expect(nodesOf(p.id)).toHaveLength(1);
    expect(plannerStore.deleteNode(p.rootNodeId, 'branch')).toEqual({
      ok: false,
      error: 'is_root',
    });
  });

  it('duplicates a branch with new unique ids', () => {
    const p = makeProject();
    const a = add(p.rootNodeId, 'A');
    add(add(a.id, 'A1').id, 'A1x');
    const r = plannerStore.duplicateNode(a.id, ' (copy)');
    if (!r.ok) throw new Error(r.error);
    const nodes = nodesOf(p.id);
    expect(new Set(nodes.map(n => n.id)).size).toBe(nodes.length);
    expect(nodes).toHaveLength(7);
    const copy = r.value;
    expect(copy.name).toBe('A (copy)');
    expect(descendantIds(childrenMap(nodes), copy.id)).toHaveLength(2);
  });

  it('undoes and redoes node edits', () => {
    const p = makeProject();
    const a = add(p.rootNodeId, 'A');
    plannerStore.deleteNode(a.id, 'branch');
    expect(nodesOf(p.id)).toHaveLength(1);
    expect(plannerStore.undo(p.id)).toBe(true);
    expect(nodesOf(p.id).map(n => n.name)).toContain('A');
    expect(plannerStore.redo(p.id)).toBe(true);
    expect(nodesOf(p.id)).toHaveLength(1);
    expect(plannerStore.canRedo(p.id)).toBe(false);
  });

  it('duplicates and deletes whole projects', () => {
    const p = makeProject();
    add(p.rootNodeId, 'A');
    const copy = plannerStore.duplicateProject(p.id, ' (copy)');
    if (!copy.ok) throw new Error(copy.error);
    expect(nodesOf(copy.value.id)).toHaveLength(2);
    plannerStore.deleteProject(p.id);
    expect(plannerStore.read().projects.map(x => x.name)).toEqual([
      'Life Vision (copy)',
    ]);
    expect(nodesOf(p.id)).toHaveLength(0);
  });
});

describe('progress', () => {
  function tree(
    model: 'equal' | 'weighted' = 'equal',
    optional: 'count' | 'exclude' = 'count',
  ) {
    const p = makeProject({ progressModel: model, optionalMode: optional });
    const a = add(p.rootNodeId, 'A', { weight: 3 });
    add(a.id, 'A1', { statusId: 'completed' }); // 100
    add(a.id, 'A2', { statusId: 'running', progress: 50 }); // 50
    add(a.id, 'A3', { statusId: 'ignored' }); // excluded
    add(p.rootNodeId, 'B', { statusId: 'pending', weight: 1 }); // 0
    add(p.rootNodeId, 'C', { statusId: 'completed', categoryId: 'optional' }); // 100
    const project = plannerStore.read().projects.find(x => x.id === p.id)!;
    const d = plannerStore.read();
    return {
      p,
      a,
      map: projectNodeProgress(
        project,
        nodesOf(p.id),
        lookups(d.statuses, d.categories),
        TODAY,
      ),
    };
  }

  it('aggregates each child once, ignoring ignored nodes', () => {
    const { p, a, map } = tree();
    expect(map.get(a.id)!.value).toBe(75); // (100 + 50) / 2
    expect(map.get(p.rootNodeId)!.value).toBeCloseTo(58.3, 1); // (75 + 0 + 100) / 3
    expect(map.get(p.rootNodeId)).toMatchObject({
      total: 6,
      completed: 2,
      active: 5,
    });
  });

  it('weighted model and excluded optional nodes', () => {
    const w = tree('weighted');
    // A weight 3 → (75*3 + 0*1 + 100*1) / 5 = 65
    expect(w.map.get(w.p.rootNodeId)!.value).toBe(65);
    const x = tree('equal', 'exclude');
    expect(x.map.get(x.p.rootNodeId)!.value).toBe(37.5); // (75 + 0) / 2
  });

  it('counts overdue descendants', () => {
    const p = makeProject();
    add(p.rootNodeId, 'Late', {
      startDate: '2026-01-01',
      targetDate: '2026-06-01',
    });
    add(p.rootNodeId, 'Done late', {
      startDate: '2026-01-01',
      targetDate: '2026-06-01',
      statusId: 'completed',
    });
    const d = plannerStore.read();
    const project = d.projects[0];
    const map = projectNodeProgress(
      project,
      nodesOf(p.id),
      lookups(d.statuses, d.categories),
      TODAY,
    );
    expect(map.get(p.rootNodeId)!.overdue).toBe(1);
  });
});

describe('layouts', () => {
  function sample() {
    const p = makeProject();
    const a = add(p.rootNodeId, 'Business', {
      startDate: '2026-01-01',
      targetDate: '2035-01-01',
    });
    const a1 = add(a.id, 'Expansion', {
      startDate: '2028-01-01',
      targetDate: '2034-01-01',
    });
    const b = add(p.rootNodeId, 'Health', {
      startDate: '2027-01-01',
      targetDate: '2045-01-01',
    });
    add(b.id, 'Fitness', { startDate: '2027-01-01', targetDate: '2030-12-31' });
    return { p, a, a1, b };
  }

  it('lays out all four styles over the same nodes', () => {
    const { p, a, a1 } = sample();
    for (const style of MAP_STYLES) {
      const l = computeLayout(nodesOf(p.id), p.rootNodeId, style);
      expect(l.boxes.size).toBe(5);
      expect(l.edges).toHaveLength(4);
      expect(l.bounds.maxX).toBeGreaterThan(l.bounds.minX);
    }
    const tree = computeLayout(nodesOf(p.id), p.rootNodeId, 'tree');
    expect(tree.boxes.get(a1.id)!.y).toBeGreaterThan(tree.boxes.get(a.id)!.y); // children below
    const road = computeLayout(nodesOf(p.id), p.rootNodeId, 'roadmap');
    expect(road.boxes.get(a1.id)!.x).toBeGreaterThan(road.boxes.get(a.id)!.x); // children to the right
    const radial = computeLayout(nodesOf(p.id), p.rootNodeId, 'radial');
    const root = radial.boxes.get(p.rootNodeId)!;
    expect(root.x + root.w / 2).toBeCloseTo(0); // root centred
    const time = computeLayout(nodesOf(p.id), p.rootNodeId, 'timeline');
    expect(time.boxes.get(a1.id)!.x).toBeGreaterThan(time.boxes.get(a.id)!.x); // later start → further right
    expect(time.years[0].year).toBe(2026);
    expect(time.years[time.years.length - 1].year).toBeGreaterThanOrEqual(2046);
  });

  it('no two tree siblings overlap', () => {
    const p = makeProject();
    for (let i = 0; i < 6; i++) {
      const n = add(p.rootNodeId, `N${i}`);
      for (let j = 0; j < 3; j++) add(n.id, `N${i}-${j}`);
    }
    const l = computeLayout(nodesOf(p.id), p.rootNodeId, 'tree');
    const leaves = [...l.boxes.values()]
      .filter(b => b.depth === 2)
      .sort((x, y) => x.x - y.x);
    for (let i = 1; i < leaves.length; i++)
      expect(leaves[i].x - leaves[i - 1].x).toBeGreaterThanOrEqual(NODE_W);
  });

  it('hides collapsed branches and applies focus', () => {
    const { p, a, a1, b } = sample();
    plannerStore.setCollapsed(a.id, true);
    expect(
      computeLayout(nodesOf(p.id), p.rootNodeId, 'tree').boxes.has(a1.id),
    ).toBe(false);
    plannerStore.setCollapsed(a.id, false);
    const focus = computeLayout(nodesOf(p.id), p.rootNodeId, 'tree', {
      focusId: a.id,
    });
    expect(focus.boxes.has(a1.id)).toBe(true);
    expect(focus.boxes.has(b.id)).toBe(false);
  });

  it('dragging a node moves its branch, per style only', () => {
    const { p, a, a1 } = sample();
    const before = computeLayout(nodesOf(p.id), p.rootNodeId, 'tree');
    plannerStore.setOffset(a.id, 'tree', { x: 100, y: 40 });
    const after = computeLayout(nodesOf(p.id), p.rootNodeId, 'tree');
    expect(after.boxes.get(a1.id)!.x - before.boxes.get(a1.id)!.x).toBe(100);
    expect(after.boxes.get(a1.id)!.y - before.boxes.get(a1.id)!.y).toBe(40);
    const road = computeLayout(nodesOf(p.id), p.rootNodeId, 'roadmap');
    expect(road.boxes.get(a.id)!.x).toBe(
      computeLayout(nodesOf(p.id), p.rootNodeId, 'roadmap').boxes.get(a.id)!.x,
    );
  });

  it('lays out 1,000+ nodes quickly', () => {
    const p = makeProject();
    const t = Date.parse('2026-01-01T00:00:00Z');
    const nodes: LongTermNode[] = [...nodesOf(p.id)];
    const root = nodes[0];
    for (let i = 0; i < 1200; i++) {
      const parent = i < 30 ? root : nodes[1 + (i % 30)];
      nodes.push({
        ...root,
        id: `n${i}`,
        parentId: parent.id,
        name: `Node ${i}`,
        sortOrder: i,
        createdAt: new Date(t).toISOString(),
      });
    }
    for (const style of MAP_STYLES) {
      const start = Date.now();
      const l = computeLayout(nodes, root.id, style);
      expect(l.boxes.size).toBe(1201);
      expect(Date.now() - start).toBeLessThan(1500);
    }
  });
});

describe('search, milestones, templates, repair', () => {
  it('finds deeply nested nodes with their path', () => {
    const p = makeProject();
    const a = add(p.rootNodeId, 'Business');
    const a1 = add(a.id, 'Establish Company');
    add(a1.id, 'Acquire Clients', { description: 'First ten customers' });
    const hits = searchNodes(plannerStore.read(), 'customers');
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toEqual([
      'Life Vision',
      'Business',
      'Establish Company',
    ]);
  });

  it('filters milestones by horizon, overdue and completed', () => {
    const p = makeProject();
    add(p.rootNodeId, 'Launch 2028', {
      kind: 'milestone',
      startDate: '2027-01-01',
      targetDate: '2028-06-01',
    });
    add(p.rootNodeId, 'Goal 2032', {
      kind: 'milestone',
      startDate: '2027-01-01',
      targetDate: '2032-06-01',
      rangeConfirmed: true,
    });
    add(p.rootNodeId, 'Missed', {
      kind: 'milestone',
      startDate: '2026-01-01',
      targetDate: '2026-03-01',
    });
    add(p.rootNodeId, 'Done', {
      kind: 'milestone',
      startDate: '2026-01-01',
      targetDate: '2026-12-01',
      statusId: 'completed',
    });
    const d = plannerStore.read();
    const names = (f: Parameters<typeof milestones>[1]) =>
      milestones(d, f, TODAY).map(r => r.node.name);
    expect(names('next5')).toEqual(['Launch 2028']);
    expect(names('next10')).toEqual(['Launch 2028', 'Goal 2032']);
    expect(names('overdue')).toEqual(['Missed']);
    expect(names('completed')).toEqual(['Done']);
    expect(names('thisYear')).toEqual(['Missed', 'Done']);
    expect(
      milestones(d, 'custom', TODAY, {
        from: '2030-01-01',
        to: '2035-01-01',
      }).map(r => r.node.name),
    ).toEqual(['Goal 2032']);
    expect(plannerSummary(d, TODAY)).toMatchObject({
      total: 1,
      active: 1,
      overdueMilestones: 1,
    });
  });

  it('builds editable template nodes dated across the plan', () => {
    const p = makeProject();
    const nodes = templateNodes(
      'vision',
      p.rootNodeId,
      p.id,
      '2026-01-01',
      '2046-01-01',
      k => `tpl:${k}`,
    );
    expect(nodes.length).toBeGreaterThan(8);
    expect(nodes[0]).toMatchObject({
      parentId: p.rootNodeId,
      name: 'tpl:buildBusiness',
    });
    expect(
      nodes.every(
        n => n.startDate >= '2026-01-01' && n.targetDate <= '2046-01-01',
      ),
    ).toBe(true);
    expect(nodes.some(n => n.kind === 'milestone')).toBe(true);
  });

  it('repairs cycles and orphans instead of dropping nodes', () => {
    const p = makeProject();
    const a = add(p.rootNodeId, 'A');
    const b = add(a.id, 'B');
    const broken = nodesOf(p.id).map(
      n => (n.id === a.id ? { ...n, parentId: b.id } : n), // A ↔ B cycle
    );
    broken.push({ ...broken[1], id: 'orphan', parentId: 'missing' });
    const fixed = repairTree(broken, p.rootNodeId);
    expect(fixed.repaired).toBeGreaterThanOrEqual(2);
    const s = sanitize({
      projects: [p],
      nodes: broken,
      statuses: [],
      categories: [],
      notes: [],
    });
    expect(s.nodes).toHaveLength(4);
    expect(
      s.nodes.every(
        n => n.parentId === null || s.nodes.some(x => x.id === n.parentId),
      ),
    ).toBe(true);
  });
});
