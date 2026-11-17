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

export interface ParityOpts {
  /** extra JSON keys whose values legitimately differ between runs (ids of newly created docs, timestamps) */
  volatile?: string[];
  /** true when the case creates docs (ids/timestamps differ): masks VOLATILE keys + skips etag/content-length */
  creates?: boolean;
}

/**
 * Runs one request against legacy and new from the SAME memory-DB state and compares
 * the response (status, headers, body) and the DB state each side left behind.
 */
export const runParity = async (ports: { legacyPort: number; newPort: number }, r: Req, opts: ParityOpts = {}) => {
  const before = memoryDb.snapshot();
  const a = pick(await send(ports.legacyPort, r));
  const dbA = memoryDb.snapshot();
  memoryDb.restore(before);
  const b = pick(await send(ports.newPort, r));
  const dbB = memoryDb.snapshot();
  const keys = opts.creates ? [...VOLATILE, ...(opts.volatile || [])] : opts.volatile || [];
  const norm = (x: ReturnType<typeof pick>) => {
    const out = { ...x, headers: { ...x.headers } };
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
