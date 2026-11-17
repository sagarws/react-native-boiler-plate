import { memoryDb } from './memory-db';
import { pick, send, Req } from './parity';

const VOLATILE = ['_id', 'id', 'createdAt', 'updatedAt', '__v'];
const maskDeep = (v: any, keys: string[]): any => {
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, keys));
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object') {
    if (v._bsontype === 'ObjectId') return String(v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keys.includes(k) ? '<v>' : maskDeep(x, keys)]));
  }
  return v;
};

/** A request that gets no response within this time counts as "hung" (legacy Express 4 leaves
 * async-rejected handlers open). Both sides hanging is parity. */
export const HANG_MS = 1500;
const sendOrHang = (port: number, r: Req) =>
  Promise.race([
    send(port, r),
    new Promise<any>((res) => setTimeout(() => res({ status: -1, headers: {}, body: 'NO RESPONSE (hung)' }), HANG_MS)),
  ]);

export interface ParityOpts {
  /** extra JSON keys whose values legitimately differ between runs (ids of newly created docs, timestamps) */
  volatile?: string[];
  /** true when the case creates docs (ids/timestamps differ): masks VOLATILE keys + skips etag/content-length */
  creates?: boolean;
  /** header value patterns to mask (e.g. a timestamp in a download filename) */
  headerMasks?: Record<string, RegExp>;
}

/**
 * Runs one request against legacy and new from the SAME memory-DB state and compares
 * the response (status, headers, body) and the DB state each side left behind.
 */
export const runParity = async (ports: { legacyPort: number; newPort: number }, r: Req, opts: ParityOpts = {}) => {
  const before = memoryDb.snapshot();
  const a = pick(await sendOrHang(ports.legacyPort, r));
  const dbA = memoryDb.snapshot();
  memoryDb.restore(before);
  const b = pick(await sendOrHang(ports.newPort, r));
  const dbB = memoryDb.snapshot();
  const keys = opts.creates ? [...VOLATILE, ...(opts.volatile || [])] : opts.volatile || [];
  const norm = (x: ReturnType<typeof pick>) => {
    const out = { ...x, headers: { ...x.headers } };
    for (const [h, re] of Object.entries(opts.headerMasks || {})) {
      if (typeof out.headers[h] === 'string') out.headers[h] = (out.headers[h] as string).replace(re, '<v>');
    }
    if (keys.length) {
      try { out.body = JSON.stringify(maskDeep(JSON.parse(x.body), keys)); } catch { /* text body */ }
      delete out.headers.etag;
      delete out.headers['content-length'];
    }
    return out;
  };
  const dbNorm = (snap: Map<string, any[]>) => maskDeep(Object.fromEntries(snap), opts.creates ? [...keys] : keys);
  return { legacy: norm(a), next: norm(b), legacyDb: dbNorm(dbA), nextDb: dbNorm(dbB), raw: { a, b } };
};
