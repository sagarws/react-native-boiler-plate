import type { PhotoMode } from '../types';

/**
 * Where the photo is drawn inside a widget — the JS mirror of
 * android/.../photowidget/PhotoMath.kt (same rules, both unit tested), so
 * the in-app preview matches the home-screen widget exactly.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Layout {
  frame: Box;
  /** Part of the photo shown, in photo pixels. */
  src: Box;
  /** Where it's drawn, in widget pixels. */
  dst: Box;
}

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

export function frameBox(
  boxW: number,
  boxH: number,
  frameW: number,
  frameH: number,
): Box {
  if (frameW <= 0 || frameH <= 0)
    return { left: 0, top: 0, width: boxW, height: boxH };
  const aspect = frameW / frameH;
  const width = Math.min(boxW, boxH * aspect);
  const height = width / aspect;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

export function photoLayout(o: {
  imgW: number;
  imgH: number;
  boxW: number;
  boxH: number;
  mode: PhotoMode;
  frameW?: number;
  frameH?: number;
  focusX?: number;
  focusY?: number;
  zoom?: number;
}): Layout {
  const f = frameBox(o.boxW, o.boxH, o.frameW ?? 0, o.frameH ?? 0);
  const iw = Math.max(1, o.imgW);
  const ih = Math.max(1, o.imgH);
  if (o.mode === 'fit') {
    const s = Math.min(f.width / iw, f.height / ih);
    const w = iw * s;
    const h = ih * s;
    return {
      frame: f,
      src: { left: 0, top: 0, width: iw, height: ih },
      dst: {
        left: f.left + (f.width - w) / 2,
        top: f.top + (f.height - h) / 2,
        width: w,
        height: h,
      },
    };
  }
  const crop = o.mode === 'crop';
  const z = crop ? clamp(o.zoom ?? 1, 1, 4) : 1;
  const s = Math.max(f.width / iw, f.height / ih) * z;
  const sw = Math.min(iw, f.width / s);
  const sh = Math.min(ih, f.height / s);
  const fx = crop ? clamp(o.focusX ?? 0.5, 0, 1) : 0.5;
  const fy = crop ? clamp(o.focusY ?? 0.5, 0, 1) : 0.5;
  const cx = clamp(fx * iw, sw / 2, iw - sw / 2);
  const cy = clamp(fy * ih, sh / 2, ih - sh / 2);
  return {
    frame: f,
    src: { left: cx - sw / 2, top: cy - sh / 2, width: sw, height: sh },
    dst: f,
  };
}

/**
 * How to place the whole photo (an <Image> of imgW × imgH scaled) so that
 * [l].src lands on [l].dst: its size and offset inside the widget box.
 */
export function imagePlacement(l: Layout, imgW: number, imgH: number): Box {
  const scale = l.dst.width / Math.max(1e-6, l.src.width);
  return {
    left: l.dst.left - l.src.left * scale,
    top: l.dst.top - l.src.top * scale,
    width: imgW * scale,
    height: imgH * scale,
  };
}

/** A new focus point after dragging the preview by (dx, dy) px. */
export function dragFocus(
  focus: { x: number; y: number },
  dx: number,
  dy: number,
  placedW: number,
  placedH: number,
): { x: number; y: number } {
  return {
    x: clamp(focus.x - dx / Math.max(1, placedW), 0, 1),
    y: clamp(focus.y - dy / Math.max(1, placedH), 0, 1),
  };
}
