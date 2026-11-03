import { diffDays } from '@/shared/utils/dayKey';
import type { DayKey, LongTermNode, MapStyle } from '../types';
import {
  ancestorIds,
  childrenMap,
  descendantIds,
  indexById,
  type ChildrenMap,
} from './hierarchy';

/**
 * Mind-map layouts. Pure: (nodes, style, options) → boxes, connector paths
 * and bounds, so the canvas can cache the result and only recompute when
 * the tree, a collapse/focus or the style changes — never while panning.
 * All loops are iterative, so very deep trees can't overflow the stack.
 *
 * Every style lays out the same visible tree (collapsed branches hidden;
 * in focus mode only the focused branch and its ancestor path), then adds
 * the user's dragged offsets for that style (a dragged node moves with its
 * branch).
 */

export const NODE_W = 184;
export const NODE_H = 78;
const TREE_GAP_X = 28;
const TREE_GAP_Y = 76;
const ROAD_GAP_X = 70;
const ROAD_GAP_Y = 18;
const RADIAL_RING = 250;
const TIMELINE_ROW = NODE_H + 26;
/** Pixels per year on the timeline (decades stay navigable). */
export const TIMELINE_YEAR_PX = 260;

export interface Box {
  id: string;
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Timeline: the node's date range as a bar [x1, x2] under its row. */
  bar?: { x1: number; x2: number; y: number };
}

export interface Point {
  x: number;
  y: number;
}

export interface Edge {
  from: string;
  to: string;
  points: Point[];
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface YearMark {
  x: number;
  year: number;
}

export interface Layout {
  style: MapStyle;
  boxes: Map<string, Box>;
  /** Draw order (parents first). */
  order: string[];
  edges: Edge[];
  bounds: Bounds;
  /** Timeline only: one mark per year. */
  years: YearMark[];
}

export interface LayoutOptions {
  /** Show only this node's branch (plus its path from the root). */
  focusId?: string | null;
}

/** The visible tree: collapsed branches hidden, focus applied. */
export function visibleChildren(
  nodes: readonly LongTermNode[],
  rootId: string,
  options: LayoutOptions = {},
): { map: ChildrenMap; ids: Set<string> } {
  const full = childrenMap(nodes);
  let allowed: Set<string> | null = null;
  if (options.focusId && options.focusId !== rootId) {
    const byId = indexById(nodes);
    allowed = new Set([
      options.focusId,
      ...ancestorIds(byId, options.focusId),
      ...descendantIds(full, options.focusId),
    ]);
  }
  const map: ChildrenMap = new Map();
  const ids = new Set<string>([rootId]);
  const byId = indexById(nodes);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const node = byId.get(id);
    if (!node || node.collapsed) continue;
    const kids = (full.get(id) ?? []).filter(
      k => !allowed || allowed.has(k.id),
    );
    if (!kids.length) continue;
    map.set(id, kids);
    for (const k of kids) {
      ids.add(k.id);
      stack.push(k.id);
    }
  }
  return { map, ids };
}

/** Pre-order (parent before children) of the visible tree. */
function preorder(map: ChildrenMap, rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const kids = map.get(id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i].id);
  }
  return out;
}

/** Extent each subtree needs along the sibling axis (leaf = [size]). */
function subtreeExtent(
  map: ChildrenMap,
  order: string[],
  size: number,
  gap: number,
): Map<string, number> {
  const ext = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const kids = map.get(id) ?? [];
    if (!kids.length) {
      ext.set(id, size);
      continue;
    }
    const sum =
      kids.reduce((s, k) => s + ext.get(k.id)!, 0) + gap * (kids.length - 1);
    ext.set(id, Math.max(size, sum));
  }
  return ext;
}

/** Max length of one straight piece of a sampled curve, in layout units. */
const CURVE_STEP = 12;
/** Timeline elbow: corner radius and the samples that draw it. */
const ELBOW_RADIUS = 18;
const ELBOW_STEPS = 6;

/** Samples for a curve between a and b: enough that it reads as smooth. */
export function curveSteps(a: Point, b: Point): number {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  return Math.max(8, Math.min(48, Math.ceil((dist * 1.2) / CURVE_STEP)));
}

/** Cubic S-curve between two points, sampled into a polyline. */
export function sCurve(
  a: Point,
  b: Point,
  vertical: boolean,
  steps = curveSteps(a, b),
): Point[] {
  const c1 = vertical
    ? { x: a.x, y: (a.y + b.y) / 2 }
    : { x: (a.x + b.x) / 2, y: a.y };
  const c2 = vertical
    ? { x: b.x, y: (a.y + b.y) / 2 }
    : { x: (a.x + b.x) / 2, y: b.y };
  const pts: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    // Ease the samples toward both ends, where an S-curve bends hardest.
    const t = (1 - Math.cos((i / steps) * Math.PI)) / 2;
    const u = 1 - t;
    pts.push({
      x:
        u * u * u * a.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * b.x,
      y:
        u * u * u * a.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * b.y,
    });
  }
  // Straight lines need no samples.
  return a.x === b.x || a.y === b.y ? [a, b] : pts;
}

function hierarchical(
  map: ChildrenMap,
  rootId: string,
  vertical: boolean,
): Map<string, Box> {
  const order = preorder(map, rootId);
  const along = vertical ? NODE_W : NODE_H;
  const gap = vertical ? TREE_GAP_X : ROAD_GAP_Y;
  const ext = subtreeExtent(map, order, along, gap);
  const boxes = new Map<string, Box>();
  // start = where the subtree begins on the sibling axis.
  const start = new Map<string, number>([[rootId, -ext.get(rootId)! / 2]]);
  const depth = new Map<string, number>([[rootId, 0]]);
  for (const id of order) {
    const s = start.get(id)!;
    const e = ext.get(id)!;
    const d = depth.get(id)!;
    const mid = s + e / 2;
    boxes.set(
      id,
      vertical
        ? {
            id,
            x: mid - NODE_W / 2,
            y: d * (NODE_H + TREE_GAP_Y),
            w: NODE_W,
            h: NODE_H,
            depth: d,
          }
        : {
            id,
            x: d * (NODE_W + ROAD_GAP_X),
            y: mid - NODE_H / 2,
            w: NODE_W,
            h: NODE_H,
            depth: d,
          },
    );
    let cursor =
      s +
      (e -
        ((map.get(id) ?? []).reduce((sum, k) => sum + ext.get(k.id)!, 0) +
          gap * Math.max(0, (map.get(id) ?? []).length - 1))) /
        2;
    for (const k of map.get(id) ?? []) {
      start.set(k.id, cursor);
      depth.set(k.id, d + 1);
      cursor += ext.get(k.id)! + gap;
    }
  }
  return boxes;
}

function radial(map: ChildrenMap, rootId: string): Map<string, Box> {
  const order = preorder(map, rootId);
  const leaves = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const kids = map.get(order[i]) ?? [];
    leaves.set(
      order[i],
      kids.length ? kids.reduce((s, k) => s + leaves.get(k.id)!, 0) : 1,
    );
  }
  const total = leaves.get(rootId)!;
  const depth = new Map<string, number>([[rootId, 0]]);
  const range = new Map<string, [number, number]>([[rootId, [0, Math.PI * 2]]]);
  const perDepth = new Map<number, number>();
  for (const id of order) {
    const d = depth.get(id)!;
    perDepth.set(d, (perDepth.get(d) ?? 0) + 1);
    const [a0, a1] = range.get(id)!;
    let a = a0;
    const own = leaves.get(id)!;
    for (const k of map.get(id) ?? []) {
      const span = ((a1 - a0) * leaves.get(k.id)!) / own;
      range.set(k.id, [a, a + span]);
      depth.set(k.id, d + 1);
      a += span;
    }
  }
  // Ring radius: at least one ring step out, and wide enough for its cards.
  const radius = new Map<number, number>([[0, 0]]);
  const maxDepth = Math.max(...perDepth.keys());
  for (let d = 1; d <= maxDepth; d++) {
    const fit = ((perDepth.get(d) ?? 1) * (NODE_W * 0.72)) / (Math.PI * 2);
    radius.set(d, Math.max(radius.get(d - 1)! + RADIAL_RING, fit));
  }
  const boxes = new Map<string, Box>();
  for (const id of order) {
    const d = depth.get(id)!;
    const [a0, a1] = range.get(id)!;
    const angle =
      total === 1 && d > 0 ? -Math.PI / 2 : (a0 + a1) / 2 - Math.PI / 2;
    const r = radius.get(d)!;
    boxes.set(id, {
      id,
      x: Math.cos(angle) * r - NODE_W / 2,
      y: Math.sin(angle) * r - NODE_H / 2,
      w: NODE_W,
      h: NODE_H,
      depth: d,
    });
  }
  return boxes;
}

const dayX = (origin: DayKey, day: DayKey) =>
  (diffDays(origin, day) / 365.2425) * TIMELINE_YEAR_PX;

function timeline(
  map: ChildrenMap,
  rootId: string,
  byId: ReadonlyMap<string, LongTermNode>,
): { boxes: Map<string, Box>; years: YearMark[] } {
  const order = preorder(map, rootId);
  const days = order.flatMap(id => {
    const n = byId.get(id)!;
    return [n.startDate, n.targetDate];
  });
  const min = days.reduce((a, b) => (b < a ? b : a));
  const max = days.reduce((a, b) => (b > a ? b : a));
  const origin = `${min.slice(0, 4)}-01-01`;
  const depth = new Map<string, number>([[rootId, 0]]);
  const boxes = new Map<string, Box>();
  order.forEach((id, row) => {
    const n = byId.get(id)!;
    const d = depth.get(id)!;
    for (const k of map.get(id) ?? []) depth.set(k.id, d + 1);
    const x1 = dayX(origin, n.startDate);
    const x2 = Math.max(x1 + 4, dayX(origin, n.targetDate));
    const y = 40 + row * TIMELINE_ROW;
    boxes.set(id, {
      id,
      x: x1,
      y,
      w: NODE_W,
      h: NODE_H,
      depth: d,
      bar: { x1, x2, y: y + NODE_H + 6 },
    });
  });
  const years: YearMark[] = [];
  const lastYear = Number(max.slice(0, 4)) + 1;
  for (let y = Number(origin.slice(0, 4)); y <= lastYear; y++) {
    years.push({ year: y, x: dayX(origin, `${y}-01-01`) });
  }
  return { boxes, years };
}

/** Adds each node's dragged offset (for [style]) to it and its branch. */
function applyOffsets(
  boxes: Map<string, Box>,
  map: ChildrenMap,
  rootId: string,
  byId: ReadonlyMap<string, LongTermNode>,
  style: MapStyle,
) {
  const acc = new Map<string, Point>([
    [rootId, byId.get(rootId)?.offsets[style] ?? { x: 0, y: 0 }],
  ]);
  for (const id of preorder(map, rootId)) {
    const base = acc.get(id)!;
    const box = boxes.get(id);
    if (box && (base.x || base.y)) {
      box.x += base.x;
      box.y += base.y;
      if (box.bar)
        box.bar = {
          x1: box.bar.x1 + base.x,
          x2: box.bar.x2 + base.x,
          y: box.bar.y + base.y,
        };
    }
    for (const k of map.get(id) ?? []) {
      const o = byId.get(k.id)?.offsets[style];
      acc.set(k.id, o ? { x: base.x + o.x, y: base.y + o.y } : base);
    }
  }
}

function edgesFor(
  style: MapStyle,
  map: ChildrenMap,
  boxes: Map<string, Box>,
): Edge[] {
  const edges: Edge[] = [];
  for (const [parentId, kids] of map) {
    if (parentId === null) continue;
    const p = boxes.get(parentId);
    if (!p) continue;
    for (const k of kids) {
      const c = boxes.get(k.id);
      if (!c) continue;
      let points: Point[];
      if (style === 'tree') {
        points = sCurve(
          { x: p.x + p.w / 2, y: p.y + p.h },
          { x: c.x + c.w / 2, y: c.y },
          true,
        );
      } else if (style === 'roadmap') {
        points = sCurve(
          { x: p.x + p.w, y: p.y + p.h / 2 },
          { x: c.x, y: c.y + c.h / 2 },
          false,
        );
      } else if (style === 'radial') {
        const a = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
        const b = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
        // Gentle curve: bend the midpoint sideways a little.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const ctrl = { x: mx - (b.y - a.y) * 0.12, y: my + (b.x - a.x) * 0.12 };
        points = [];
        const steps = curveSteps(a, b);
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const u = 1 - t;
          points.push({
            x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
            y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
          });
        }
      } else {
        // Timeline elbow: down from the parent's left edge, across to the child.
        // The corner is a quarter-round arc rather than a sharp bend.
        const sx = p.x + 10;
        const top = p.y + p.h;
        const cy = c.y + c.h / 2;
        const r = Math.max(
          0,
          Math.min(ELBOW_RADIUS, Math.abs(cy - top), Math.abs(c.x - sx)),
        );
        const dirY = cy >= top ? 1 : -1;
        const dirX = c.x >= sx ? 1 : -1;
        points = [{ x: sx, y: top }];
        for (let i = 0; i <= ELBOW_STEPS; i++) {
          const ang = ((i / ELBOW_STEPS) * Math.PI) / 2;
          points.push({
            x: sx + dirX * r * (1 - Math.cos(ang)),
            y: cy - dirY * r * (1 - Math.sin(ang)),
          });
        }
        points.push({ x: c.x, y: cy });
        // The arc can end exactly on a straight run's end: drop repeats.
        points = points.filter(
          (q, i) =>
            i === 0 ||
            Math.hypot(q.x - points[i - 1].x, q.y - points[i - 1].y) > 0.01,
        );
      }
      edges.push({ from: parentId, to: k.id, points });
    }
  }
  return edges;
}

function boundsOf(boxes: Iterable<Box>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x, b.bar?.x1 ?? Infinity);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w, b.bar?.x2 ?? -Infinity);
    maxY = Math.max(maxY, b.y + b.h + (b.bar ? 14 : 0));
  }
  return Number.isFinite(minX)
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export function computeLayout(
  nodes: readonly LongTermNode[],
  rootId: string,
  style: MapStyle,
  options: LayoutOptions = {},
): Layout {
  const byId = indexById(nodes);
  if (!byId.has(rootId)) {
    return {
      style,
      boxes: new Map(),
      order: [],
      edges: [],
      bounds: boundsOf([]),
      years: [],
    };
  }
  const { map } = visibleChildren(nodes, rootId, options);
  let boxes: Map<string, Box>;
  let years: YearMark[] = [];
  if (style === 'tree') boxes = hierarchical(map, rootId, true);
  else if (style === 'roadmap') boxes = hierarchical(map, rootId, false);
  else if (style === 'radial') boxes = radial(map, rootId);
  else ({ boxes, years } = timeline(map, rootId, byId));
  applyOffsets(boxes, map, rootId, byId, style);
  const bounds = boundsOf(boxes.values());
  if (style === 'timeline') {
    bounds.minY = Math.min(bounds.minY, 0);
  }
  return {
    style,
    boxes,
    order: preorder(map, rootId),
    edges: edgesFor(style, map, boxes),
    bounds,
    years,
  };
}

/** Whether a rectangle overlaps the viewport (in canvas coordinates). */
export function intersects(
  r: { x: number; y: number; w: number; h: number },
  view: Bounds,
): boolean {
  return (
    r.x + r.w >= view.minX &&
    r.x <= view.maxX &&
    r.y + r.h >= view.minY &&
    r.y <= view.maxY
  );
}
