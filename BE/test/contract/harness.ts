/**
 * Contract harness (MIGRATION_PLAN §4): sends each case to legacy (LEGACY_URL, default :8000)
 * and new (NEW_URL, default :8100) and diffs status, JSON body (key order ignored) and the
 * contract headers. Volatile values are masked by JSON path.
 *
 * Safety: write cases (POST/PUT/PATCH/DELETE) run only when CONTRACT_DB names the database both
 * servers use and it is not `prod`. Read cases always run.
 */
import { COMPARED_HEADERS } from '../support/parity';

export interface ContractCase {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
  path: string;
  headers?: Record<string, string>;
  /** object → JSON; string → sent as-is */
  body?: unknown;
  /** JSON paths whose values differ per call (`data.token`, `data.items.*.createdAt`) */
  mask?: string[];
  /** headers to skip for this case (e.g. etag when a masked field is volatile) */
  ignoreHeaders?: string[];
}

export interface Captured { status: number; headers: Record<string, string>; body: unknown; raw: string }

const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const assertWritesAllowed = (c: ContractCase, env = process.env) => {
  if (!WRITE.has(c.method)) return;
  const db = (env.CONTRACT_DB || '').trim();
  if (!db || db === 'prod' || db === 'production') {
    throw new Error(`write case "${c.name}" refused: set CONTRACT_DB to the non-prod database both servers use`);
  }
};

export const call = async (base: string, c: ContractCase): Promise<Captured> => {
  const headers: Record<string, string> = { ...(c.headers || {}) };
  let body: string | undefined;
  if (c.body !== undefined) {
    body = typeof c.body === 'string' ? c.body : JSON.stringify(c.body);
    if (typeof c.body !== 'string' && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  }
  const res = await fetch(base.replace(/\/$/, '') + c.path, { method: c.method, headers, body, redirect: 'manual' });
  const raw = await res.text();
  let parsed: unknown = raw;
  try { parsed = raw ? JSON.parse(raw) : raw; } catch { /* non-JSON body is compared as text */ }
  const h: Record<string, string> = {};
  for (const k of COMPARED_HEADERS) if (!(c.ignoreHeaders || []).includes(k)) { const v = res.headers.get(k); if (v !== null) h[k] = v; }
  return { status: res.status, headers: h, body: parsed, raw };
};

/** Replaces masked paths with "<masked>" (`*` matches any key/index). */
export const mask = (value: unknown, paths: string[] = []): unknown => {
  const clone = JSON.parse(JSON.stringify(value ?? null));
  const apply = (node: any, parts: string[]) => {
    if (node === null || typeof node !== 'object' || !parts.length) return;
    const [head, ...rest] = parts;
    const keys = head === '*' ? Object.keys(node) : [head];
    for (const k of keys) {
      if (!(k in node)) continue;
      if (!rest.length) node[k] = '<masked>';
      else apply(node[k], rest);
    }
  };
  for (const p of paths) apply(clone, p.split('.'));
  return clone;
};

export const normalize = (c: Captured, cc: ContractCase) => {
  const headers = { ...c.headers };
  if (cc.mask?.length) { delete headers.etag; delete headers['content-length']; }
  return { status: c.status, headers, body: mask(c.body, cc.mask) };
};
