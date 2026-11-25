import { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';
import type { InputEvent, TouchMode } from '../types';
import {
  clampPan,
  toRemotePoint,
  videoRect,
  type Size,
} from '../utils/geometry';

/*
 * Touch → remote mouse, for a phone screen.
 *
 * Touch mode (the finger is the pointer):
 *   tap = click · drag = press-and-drag (select, move windows; swipe on a
 *   phone) · hold = right click on a computer, long press on a phone
 * Trackpad mode (a cursor you move): drag = move the cursor · tap = click ·
 *   hold = right click
 * Both: two fingers = scroll (or pan when zoomed) · pinch = zoom ·
 *   two-finger tap = right click.
 *
 * Nothing is sent until a one-finger gesture is clearly a tap, a drag or a
 * hold, so a pinch never clicks.
 */

const SLOP = 8;
const HOLD_MS = 450;
const MAX_ZOOM = 6;
const TRACKPAD_SPEED = 1.6;

export interface GestureOptions {
  container: Size;
  /** The container's top-left on the screen (touches come in screen coordinates). */
  origin: { x: number; y: number };
  video: Size;
  mode: TouchMode;
  /** The other side is a phone: hold = long press (button held), not right click. */
  phoneHost: boolean;
  enabled: boolean;
  /** Picture at the top of the container instead of centred (keyboard open). */
  alignTop?: boolean;
  sendInput: (event: InputEvent) => void;
  sendMove: (x: number, y: number) => void;
}

type One = {
  kind: 'one';
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  phase: 'pending' | 'drag' | 'held' | 'done';
  timer: ReturnType<typeof setTimeout> | null;
};
type Two = {
  kind: 'two';
  startDist: number;
  startZoom: number;
  startPan: { x: number; y: number };
  anchor: { u: number; v: number };
  lastCx: number;
  lastCy: number;
  startCx: number;
  startCy: number;
  phase: 'pending' | 'pinch' | 'pan' | 'scroll';
  startedAt: number;
};

const touchesOf = (e: GestureResponderEvent) => e.nativeEvent.touches;

export function useViewerGestures(opts: GestureOptions) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cursor, setCursor] = useState({ x: 0.5, y: 0.5 });
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const view = useRef({ zoom: 1, pan: { x: 0, y: 0 } });
  const cursorRef = useRef({ x: 0.5, y: 0.5 });
  const gesture = useRef<One | Two | null>(null);
  const wheel = useRef({ dx: 0, dy: 0, frame: 0 as number | 0 });

  const rect = () =>
    videoRect(
      optsRef.current.container,
      optsRef.current.video,
      view.current.zoom,
      view.current.pan,
      optsRef.current.alignTop,
    );

  const applyView = (z: number, p: { x: number; y: number }) => {
    const clamped = clampPan(
      optsRef.current.container,
      optsRef.current.video,
      z,
      p,
    );
    view.current = { zoom: z, pan: clamped };
    setZoom(z);
    setPan(clamped);
  };

  const resetView = useCallback(() => applyView(1, { x: 0, y: 0 }), []);

  /** Screen → container coordinates. */
  const local = (x: number, y: number) => ({
    x: x - optsRef.current.origin.x,
    y: y - optsRef.current.origin.y,
  });
  const point = (x: number, y: number) => {
    const l = local(x, y);
    return toRemotePoint(rect(), l.x, l.y);
  };

  const click = (b: 0 | 1 | 2, p: { x: number; y: number }) => {
    const { sendInput, sendMove } = optsRef.current;
    sendMove(p.x, p.y);
    sendInput({ k: 'md', b, x: p.x, y: p.y });
    sendInput({ k: 'mu', b, x: p.x, y: p.y });
  };

  const flushWheel = () => {
    wheel.current.frame = 0;
    const { dx, dy } = wheel.current;
    if (!dx && !dy) return;
    wheel.current.dx = 0;
    wheel.current.dy = 0;
    optsRef.current.sendInput({
      k: 'wh',
      dx: Math.round(dx),
      dy: Math.round(dy),
    });
  };

  const scroll = (dx: number, dy: number) => {
    wheel.current.dx += dx;
    wheel.current.dy += dy;
    if (!wheel.current.frame)
      wheel.current.frame = requestAnimationFrame(
        flushWheel,
      ) as unknown as number;
  };

  const moveCursor = (dx: number, dy: number) => {
    const r = rect();
    const next = {
      x: Math.min(
        1,
        Math.max(
          0,
          cursorRef.current.x + (dx * TRACKPAD_SPEED) / Math.max(1, r.width),
        ),
      ),
      y: Math.min(
        1,
        Math.max(
          0,
          cursorRef.current.y + (dy * TRACKPAD_SPEED) / Math.max(1, r.height),
        ),
      ),
    };
    cursorRef.current = next;
    setCursor(next);
    optsRef.current.sendMove(next.x, next.y);
  };

  const endOne = (g: One, cancelled: boolean) => {
    if (g.timer) clearTimeout(g.timer);
    const { mode, sendInput } = optsRef.current;
    if (mode === 'direct') {
      const p = point(g.lastX, g.lastY) ?? cursorRef.current;
      if (
        g.phase === 'drag' ||
        (g.phase === 'held' && optsRef.current.phoneHost)
      ) {
        sendInput({ k: 'mu', b: 0, x: p.x, y: p.y });
      } else if (g.phase === 'pending' && !cancelled) {
        const at = point(g.startX, g.startY);
        if (at) click(0, at);
      }
    } else if (g.phase === 'pending' && !cancelled) {
      click(0, cursorRef.current);
    } else if (g.phase === 'held' && optsRef.current.phoneHost) {
      sendInput({ k: 'mu', b: 0, ...cursorRef.current });
    }
    g.phase = 'done';
  };

  const startTwo = (e: GestureResponderEvent) => {
    const [a, b] = touchesOf(e);
    if (!a || !b) return;
    const g = gesture.current;
    if (g?.kind === 'one') endOne(g, true);
    const cx = (a.pageX + b.pageX) / 2;
    const cy = (a.pageY + b.pageY) / 2;
    const r = rect();
    const l = local(cx, cy);
    gesture.current = {
      kind: 'two',
      startDist: Math.max(1, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)),
      startZoom: view.current.zoom,
      startPan: view.current.pan,
      anchor: { u: (l.x - r.left) / r.width, v: (l.y - r.top) / r.height },
      lastCx: cx,
      lastCy: cy,
      startCx: cx,
      startCy: cy,
      phase: 'pending',
      startedAt: Date.now(),
    };
  };

  const onMoveTwo = (g: Two, e: GestureResponderEvent) => {
    const [a, b] = touchesOf(e);
    if (!a || !b) return;
    const cx = (a.pageX + b.pageX) / 2;
    const cy = (a.pageY + b.pageY) / 2;
    const ratio =
      Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) / g.startDist;
    if (g.phase === 'pending') {
      if (Math.abs(ratio - 1) > 0.12) g.phase = 'pinch';
      else if (Math.hypot(cx - g.startCx, cy - g.startCy) > SLOP * 1.5)
        g.phase = view.current.zoom > 1.01 ? 'pan' : 'scroll';
    }
    const dx = cx - g.lastCx;
    const dy = cy - g.lastCy;
    g.lastCx = cx;
    g.lastCy = cy;
    if (g.phase === 'pinch') {
      const { container, video } = optsRef.current;
      const z = Math.min(MAX_ZOOM, Math.max(1, g.startZoom * ratio));
      const base = videoRect(
        container,
        video,
        z,
        { x: 0, y: 0 },
        optsRef.current.alignTop,
      );
      // Keep the point that was under the fingers under them.
      const l = local(cx, cy);
      const left = l.x - g.anchor.u * base.width;
      const top = l.y - g.anchor.v * base.height;
      applyView(z, { x: left - base.left, y: top - base.top });
    } else if (g.phase === 'pan') {
      applyView(view.current.zoom, {
        x: view.current.pan.x + dx,
        y: view.current.pan.y + dy,
      });
    } else if (g.phase === 'scroll') {
      // Natural scrolling: fingers up → content moves up (scroll down).
      scroll(-dx * 2, -dy * 2);
    }
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderGrant: e => {
          const touches = touchesOf(e);
          if (touches.length >= 2) return startTwo(e);
          const t = touches[0] ?? e.nativeEvent;
          const g: One = {
            kind: 'one',
            startX: t.pageX,
            startY: t.pageY,
            lastX: t.pageX,
            lastY: t.pageY,
            phase: 'pending',
            timer: null,
          };
          gesture.current = g;
          if (!optsRef.current.enabled) return;
          g.timer = setTimeout(() => {
            if (gesture.current !== g || g.phase !== 'pending') return;
            const { mode, phoneHost, sendInput, sendMove } = optsRef.current;
            const p =
              mode === 'direct' ? point(g.startX, g.startY) : cursorRef.current;
            if (!p) return;
            g.phase = 'held';
            if (phoneHost) {
              // Hold the touch down: the phone sees a long press (and a long-press drag if the finger moves).
              sendMove(p.x, p.y);
              sendInput({ k: 'md', b: 0, x: p.x, y: p.y });
            } else click(2, p);
          }, HOLD_MS);
        },
        onPanResponderMove: e => {
          const touches = touchesOf(e);
          let g = gesture.current;
          if (touches.length >= 2 && g?.kind !== 'two') {
            startTwo(e);
            g = gesture.current;
          }
          if (!g) return;
          if (g.kind === 'two') return onMoveTwo(g, e);
          const t = touches[0];
          if (!t || !optsRef.current.enabled) return;
          const dx = t.pageX - g.lastX;
          const dy = t.pageY - g.lastY;
          g.lastX = t.pageX;
          g.lastY = t.pageY;
          const { mode, phoneHost, sendInput, sendMove } = optsRef.current;
          if (mode === 'trackpad') {
            if (
              g.phase === 'pending' &&
              Math.hypot(t.pageX - g.startX, t.pageY - g.startY) > SLOP
            ) {
              if (g.timer) clearTimeout(g.timer);
              g.phase = 'drag';
            }
            if (g.phase === 'drag' || (g.phase === 'held' && phoneHost))
              moveCursor(dx, dy);
            return;
          }
          if (
            g.phase === 'pending' &&
            Math.hypot(t.pageX - g.startX, t.pageY - g.startY) > SLOP
          ) {
            if (g.timer) clearTimeout(g.timer);
            const start = point(g.startX, g.startY);
            if (!start) {
              g.phase = 'done';
              return;
            }
            g.phase = 'drag';
            sendMove(start.x, start.y);
            sendInput({ k: 'md', b: 0, x: start.x, y: start.y });
          }
          if (g.phase === 'drag' || (g.phase === 'held' && phoneHost)) {
            const p = point(t.pageX, t.pageY);
            if (p) sendMove(p.x, p.y);
          }
        },
        onPanResponderRelease: () => {
          const g = gesture.current;
          gesture.current = null;
          if (!g) return;
          if (g.kind === 'one') return endOne(g, false);
          // A quick two-finger tap = right click.
          if (
            g.phase === 'pending' &&
            Date.now() - g.startedAt < 300 &&
            optsRef.current.enabled
          ) {
            const p =
              optsRef.current.mode === 'direct'
                ? point(g.startCx, g.startCy)
                : cursorRef.current;
            if (p) click(optsRef.current.phoneHost ? 0 : 2, p);
          }
        },
        onPanResponderTerminate: () => {
          const g = gesture.current;
          gesture.current = null;
          if (g?.kind === 'one') endOne(g, true);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const layout = videoRect(
    opts.container,
    opts.video,
    zoom,
    pan,
    opts.alignTop,
  );
  return {
    panHandlers: responder.panHandlers,
    layout,
    zoom,
    cursor,
    resetView,
  };
}
