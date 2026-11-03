import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { tint } from '../../utils/levelColors';
import {
  intersects,
  type Bounds,
  type Layout,
  type Point,
} from '../services/layout';
import type { PlannerView } from '../types';
import { NodeCard, type NodeCardData } from './NodeCard';

/**
 * The mind-map canvas: pan (one finger), pinch-zoom (two fingers, around
 * the pinch point), zoom buttons via the handle, fit / centre with animated
 * camera moves, tap / double tap / long press on nodes, and dragging the
 * selected node. Built on PanResponder + Animated transforms (no extra
 * native libraries).
 *
 * Performance: the camera is a transform, so panning never re-renders
 * nodes; when a gesture ends, only cards and connectors near the viewport
 * are rendered (culling), and far zoom levels draw plain blocks (LOD).
 */

export const MIN_SCALE = 0.12;
export const MAX_SCALE = 2.5;
const PAD = 120;
const DOUBLE_TAP_MS = 320;
const COMPACT_BELOW = 0.45;

export interface CanvasHandle {
  zoomBy: (factor: number) => void;
  fit: () => void;
  centerOn: (nodeId: string, minScale?: number) => void;
  view: () => PlannerView;
}

export interface MindMapCanvasProps {
  layout: Layout;
  cards: ReadonlyMap<string, NodeCardData>;
  selectedId: string | null;
  highlightId: string | null;
  initialView: PlannerView | null;
  /** Timeline: x of today, in layout coordinates (null elsewhere). */
  todayX: number | null;
  onViewChange: (view: PlannerView) => void;
  onTap: (id: string) => void;
  onDoubleTap: (id: string) => void;
  onLongPress: (id: string) => void;
  onBackgroundTap: () => void;
  /** Selected node dragged by (dx, dy) in layout units. */
  onDragEnd: (id: string, dx: number, dy: number) => void;
  testID?: string;
}

const clampScale = (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

function Segment({
  a,
  b,
  color,
  width,
}: {
  a: Point;
  b: Point;
  color: string;
  width: number;
}) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 0.5) return null;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  // Overhang by the stroke width so neighbouring pieces' round caps overlap
  // and the curve reads as one smooth line, with no notches at the joints.
  const span = length + width;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.abs,
        {
          left: (a.x + b.x) / 2 - span / 2,
          top: (a.y + b.y) / 2 - width / 2,
          width: span,
          height: width,
          borderRadius: width / 2,
          backgroundColor: color,
          transform: [{ rotate: `${angle}rad` }],
        },
      ]}
    />
  );
}

export const MindMapCanvas = forwardRef<CanvasHandle, MindMapCanvasProps>(
  function MindMapCanvasView(
    {
      layout,
      cards,
      selectedId,
      highlightId,
      initialView,
      todayX,
      onViewChange,
      onTap,
      onDoubleTap,
      onLongPress,
      onBackgroundTap,
      onDragEnd,
      testID = 'mind-map',
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { colors, typography } = useTheme();
    const [size, setSize] = useState({ w: 0, h: 0 });
    const origin = useMemo(
      () => ({ x: layout.bounds.minX - PAD, y: layout.bounds.minY - PAD }),
      [layout.bounds],
    );
    const content = {
      w: layout.bounds.maxX - layout.bounds.minX + PAD * 2,
      h: layout.bounds.maxY - layout.bounds.minY + PAD * 2,
    };

    // Camera: Animated values drive the transform; `cam` mirrors them for maths.
    const tx = useRef(new Animated.Value(initialView?.x ?? 0)).current;
    const ty = useRef(new Animated.Value(initialView?.y ?? 0)).current;
    const sc = useRef(new Animated.Value(initialView?.scale ?? 1)).current;
    const cam = useRef<PlannerView>(initialView ?? { x: 0, y: 0, scale: 1 });
    // The camera as of the last settled gesture (drives culling and LOD).
    const [settled, setSettled] = useState<PlannerView>(cam.current);
    const placed = useRef(initialView !== null);

    const setCam = (v: PlannerView) => {
      cam.current = v;
      tx.setValue(v.x);
      ty.setValue(v.y);
      sc.setValue(v.scale);
    };
    const settle = useCallback(() => {
      setSettled({ ...cam.current });
      onViewChange({ ...cam.current });
    }, [onViewChange]);

    const animateTo = useCallback(
      (v: PlannerView) => {
        cam.current = v;
        const cfg = {
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        };
        Animated.parallel([
          Animated.timing(tx, { toValue: v.x, ...cfg }),
          Animated.timing(ty, { toValue: v.y, ...cfg }),
          Animated.timing(sc, { toValue: v.scale, ...cfg }),
        ]).start(() => settle());
      },
      [settle, sc, tx, ty],
    );

    const fitView = useCallback((): PlannerView => {
      if (!size.w || !size.h) return cam.current;
      const scale = clampScale(
        Math.min(size.w / content.w, size.h / content.h, 1.1),
      );
      return {
        scale,
        x: (size.w - content.w * scale) / 2,
        y: (size.h - content.h * scale) / 2,
      };
    }, [size, content.w, content.h]);

    const centerView = useCallback(
      (id: string, minScale = 0.8): PlannerView | null => {
        const b = layout.boxes.get(id);
        if (!b || !size.w) return null;
        const scale = clampScale(Math.max(cam.current.scale, minScale));
        const cx = b.x + b.w / 2 - origin.x;
        const cy = b.y + b.h / 2 - origin.y;
        return {
          scale,
          x: size.w / 2 - cx * scale,
          y: size.h / 2 - cy * scale,
        };
      },
      [layout.boxes, size, origin],
    );

    useImperativeHandle(
      ref,
      () => ({
        zoomBy: factor => {
          const s = clampScale(cam.current.scale * factor);
          // Zoom around the viewport centre.
          const cx = (size.w / 2 - cam.current.x) / cam.current.scale;
          const cy = (size.h / 2 - cam.current.y) / cam.current.scale;
          animateTo({
            scale: s,
            x: size.w / 2 - cx * s,
            y: size.h / 2 - cy * s,
          });
        },
        fit: () => animateTo(fitView()),
        centerOn: (id, minScale) => {
          const v = centerView(id, minScale);
          if (v) animateTo(v);
        },
        view: () => ({ ...cam.current }),
      }),
      [animateTo, centerView, fitView, size],
    );

    // First layout without a saved view: fit the whole map.
    useEffect(() => {
      if (!placed.current && size.w && size.h) {
        placed.current = true;
        const v = fitView();
        setCam(v);
        settle();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size.w, size.h]);

    // ── Gestures ──
    const pressedNode = useRef<string | null>(null);
    const mode = useRef<'pan' | 'drag'>('pan');
    const last = useRef<{ x: number; y: number } | null>(null);
    const pinch = useRef<{
      dist: number;
      scale: number;
      cx: number;
      cy: number;
    } | null>(null);
    const dragDelta = useRef(new Animated.ValueXY()).current;
    const [dragging, setDragging] = useState<string | null>(null);
    const page = useRef({ x: 0, y: 0 });
    const box = useRef<View>(null);
    const selectedRef = useRef(selectedId);
    selectedRef.current = selectedId;

    const touchPoints = (e: GestureResponderEvent) =>
      e.nativeEvent.touches.map(p => ({
        x: p.pageX - page.current.x,
        y: p.pageY - page.current.y,
      }));

    const responder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => false,
          onStartShouldSetPanResponderCapture: e =>
            e.nativeEvent.touches.length > 1,
          onMoveShouldSetPanResponderCapture: (e, g) =>
            e.nativeEvent.touches.length > 1 ||
            Math.abs(g.dx) + Math.abs(g.dy) > 6,
          onPanResponderTerminationRequest: () => false,
          onPanResponderGrant: e => {
            const sel = selectedRef.current;
            mode.current =
              pressedNode.current &&
              pressedNode.current === sel &&
              e.nativeEvent.touches.length === 1
                ? 'drag'
                : 'pan';
            if (mode.current === 'drag') {
              dragDelta.setValue({ x: 0, y: 0 });
              setDragging(sel);
            }
            last.current = null;
            pinch.current = null;
          },
          onPanResponderMove: (e, g) => {
            if (mode.current === 'drag') {
              dragDelta.setValue({ x: g.dx, y: g.dy });
              return;
            }
            const pts = touchPoints(e);
            if (pts.length >= 2) {
              const [a, b] = pts;
              const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              if (!pinch.current) {
                const c = cam.current;
                pinch.current = {
                  dist,
                  scale: c.scale,
                  cx: (mid.x - c.x) / c.scale,
                  cy: (mid.y - c.y) / c.scale,
                };
              }
              const p = pinch.current;
              const s = clampScale((p.scale * dist) / p.dist);
              setCam({ scale: s, x: mid.x - p.cx * s, y: mid.y - p.cy * s });
              last.current = null;
              return;
            }
            pinch.current = null;
            const pt = pts[0];
            if (!pt) return;
            if (last.current) {
              const c = cam.current;
              setCam({
                ...c,
                x: c.x + pt.x - last.current.x,
                y: c.y + pt.y - last.current.y,
              });
            }
            last.current = pt;
          },
          onPanResponderRelease: (_e, g) => {
            if (mode.current === 'drag' && selectedRef.current) {
              const s = cam.current.scale;
              onDragEnd(selectedRef.current, g.dx / s, g.dy / s);
              setDragging(null);
            } else {
              settle();
            }
            pressedNode.current = null;
          },
          onPanResponderTerminate: () => {
            setDragging(null);
            pressedNode.current = null;
            settle();
          },
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onDragEnd, settle],
    );

    const onLayout = (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setSize({ w: width, h: height });
      box.current?.measureInWindow((x, y) => {
        page.current = { x, y };
      });
    };

    // ── Taps ──
    const lastTap = useRef<{ id: string; at: number } | null>(null);
    const tapNode = (id: string) => {
      const nowMs = Date.now();
      const prev = lastTap.current;
      if (prev && prev.id === id && nowMs - prev.at <= DOUBLE_TAP_MS) {
        lastTap.current = null;
        onDoubleTap(id);
        return;
      }
      lastTap.current = { id, at: nowMs };
      onTap(id);
    };

    // ── Culling ──
    const view = settled;
    const margin = size.w
      ? (Math.max(size.w, size.h) / view.scale) * 0.6
      : Infinity;
    const viewRect: Bounds = size.w
      ? {
          minX: -view.x / view.scale + origin.x - margin,
          minY: -view.y / view.scale + origin.y - margin,
          maxX: (size.w - view.x) / view.scale + origin.x + margin,
          maxY: (size.h - view.y) / view.scale + origin.y + margin,
        }
      : { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    const compact = view.scale < COMPACT_BELOW;

    const visibleIds = layout.order.filter(id => {
      const b = layout.boxes.get(id)!;
      return id === dragging || id === selectedId || intersects(b, viewRect);
    });
    const visibleSet = new Set(visibleIds);
    const edges = layout.edges.filter(
      e => visibleSet.has(e.from) || visibleSet.has(e.to),
    );
    const local = (p: Point): Point => ({
      x: p.x - origin.x,
      y: p.y - origin.y,
    });

    return (
      <View
        ref={box}
        style={[styles.fill, { backgroundColor: colors.background }]}
        onLayout={onLayout}
        {...responder.panHandlers}
        testID={testID}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onBackgroundTap}
          accessible={false}
          testID={`${testID}-background`}
        />
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.content,
            {
              width: content.w,
              height: content.h,
              transform: [
                { translateX: tx },
                { translateY: ty },
                { scale: sc },
              ],
            },
          ]}
        >
          {layout.style === 'timeline'
            ? layout.years.map(y => (
                <View
                  key={y.year}
                  pointerEvents="none"
                  style={[
                    styles.abs,
                    styles.top0,
                    { left: y.x - origin.x, height: content.h },
                  ]}
                >
                  <View
                    style={[
                      styles.yearLine,
                      { backgroundColor: colors.divider },
                    ]}
                  />
                  <Text
                    style={[
                      typography.label,
                      styles.yearLabel,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {y.year}
                  </Text>
                </View>
              ))
            : null}
          {todayX !== null ? (
            <View
              pointerEvents="none"
              style={[
                styles.abs,
                styles.today,
                {
                  left: todayX - origin.x,
                  height: content.h,
                  backgroundColor: colors.error,
                },
              ]}
            />
          ) : null}
          {edges.map(e => {
            const color = tint(cards.get(e.to)?.color ?? colors.border, 0.6);
            const pts = e.points.map(local);
            return (
              <React.Fragment key={`${e.from}-${e.to}`}>
                {pts.slice(1).map((p, i) => (
                  <Segment
                    key={i}
                    a={pts[i]}
                    b={p}
                    color={color}
                    width={compact ? 4 : 2.5}
                  />
                ))}
              </React.Fragment>
            );
          })}
          {visibleIds.map(id => {
            const b = layout.boxes.get(id)!;
            const card = cards.get(id);
            if (!card) return null;
            const bar = b.bar;
            return (
              <React.Fragment key={id}>
                {bar ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.abs,
                      styles.bar,
                      {
                        left: bar.x1 - origin.x,
                        top: bar.y - origin.y,
                        width: Math.max(4, bar.x2 - bar.x1),
                        borderColor: card.color,
                        backgroundColor:
                          card.statusKind === 'completed'
                            ? card.color
                            : card.statusKind === 'pending'
                            ? 'transparent'
                            : tint(card.color, 0.5),
                      },
                    ]}
                  />
                ) : null}
                <Animated.View
                  style={[
                    styles.abs,
                    { left: b.x - origin.x, top: b.y - origin.y },
                    id === dragging ? styles.dragging : null,
                    id === dragging
                      ? { transform: dragDelta.getTranslateTransform() }
                      : null,
                  ]}
                >
                  <Pressable
                    onPressIn={() => {
                      pressedNode.current = id;
                    }}
                    onPress={() => tapNode(id)}
                    onLongPress={() => onLongPress(id)}
                    delayLongPress={420}
                    accessibilityRole="button"
                    accessibilityLabel={`${card.name}, ${card.statusName}${
                      card.progress !== null
                        ? `, ${Math.round(card.progress)}%`
                        : ''
                    }`}
                    accessibilityHint={t('planner.nodeHint')}
                    accessibilityState={{
                      selected: id === selectedId,
                      expanded: card.childCount ? !card.collapsed : undefined,
                    }}
                    testID={`node-${id}`}
                  >
                    <NodeCard
                      data={card}
                      selected={id === selectedId}
                      highlighted={id === highlightId}
                      compact={compact}
                    />
                  </Pressable>
                </Animated.View>
              </React.Fragment>
            );
          })}
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  content: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'top left',
  },
  top0: { top: 0 },
  dragging: { zIndex: 10, elevation: 8 },
  abs: { position: 'absolute' },
  yearLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
  },
  yearLabel: { position: 'absolute', top: 8, left: 6 },
  today: { top: 0, width: 2, opacity: 0.6 },
  bar: { height: 8, borderRadius: 4, borderWidth: 1.5 },
});
