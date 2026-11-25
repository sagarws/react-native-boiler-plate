import type { InputEvent } from '../types';

/*
 * Input events on the data channels, validated the same way as the desktop
 * host does (shared/utils/remote.ts → parseInputEvent): anything malformed
 * is dropped.
 */

const unit = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const delta = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10_000;

export const parseInputEvent = (raw: unknown): InputEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  switch (e.k) {
    case 'mm':
      return unit(e.x) && unit(e.y) ? { k: 'mm', x: e.x, y: e.y } : null;
    case 'md':
    case 'mu': {
      const b = e.b;
      return (b === 0 || b === 1 || b === 2) && unit(e.x) && unit(e.y)
        ? { k: e.k, b, x: e.x, y: e.y }
        : null;
    }
    case 'wh':
      return delta(e.dx) && delta(e.dy)
        ? { k: 'wh', dx: e.dx, dy: e.dy }
        : null;
    case 'kd':
    case 'ku':
      return typeof e.c === 'string' && /^[A-Za-z0-9]{1,24}$/.test(e.c)
        ? { k: e.k, c: e.c }
        : null;
    case 'tx':
      return typeof e.t === 'string' && e.t.length > 0 && e.t.length <= 64
        ? { k: 'tx', t: e.t }
        : null;
    case 'rel':
      return { k: 'rel' };
    default:
      return null;
  }
};

/** Splits text into 'tx' events the host accepts (≤ 64 UTF-16 units each). */
export const textEvents = (text: string): InputEvent[] => {
  const out: InputEvent[] = [];
  const chars = Array.from(text);
  let chunk = '';
  for (const ch of chars) {
    if (chunk.length + ch.length > 64) {
      out.push({ k: 'tx', t: chunk });
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) out.push({ k: 'tx', t: chunk });
  return out;
};
