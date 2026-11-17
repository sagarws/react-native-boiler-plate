import type { FastifyRequest } from 'fastify';

/**
 * Runs legacy Express middleware `(req, res, next)` against a Fastify request and captures
 * what it does: either it calls `next()` (possibly after setting `req.user`, `req.body`, …) or it
 * answers with `res.status(x).json(...)` / `.send(...)`.
 *
 * `req` is the raw Node request, augmented once per request with the Express properties the
 * legacy code reads (`query`, `params`, `body`, `ip`, `get()`, …). Properties the middleware sets
 * on it (`user`, `companyId`, `role`, `supportAgent`, `externalClient`, …) stay on it, so later
 * middleware and handlers see them exactly like in Express.
 */

export type LegacyMiddleware = (req: any, res: any, next: (err?: unknown) => void) => unknown;

export interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type MiddlewareOutcome =
  | { kind: 'next' }
  | { kind: 'error'; error: unknown }
  | { kind: 'response'; response: CapturedResponse };

const LEGACY_REQ = Symbol('legacyReq');

/** Express-shaped view of the request (one per request, shared by all middleware + handler). */
export const legacyRequest = (request: FastifyRequest): any => {
  const raw: any = request.raw;
  if (!raw[LEGACY_REQ]) {
    raw[LEGACY_REQ] = true;
    raw.query = request.query ?? {};
    raw.params = request.params ?? {};
    raw.originalUrl = request.raw.url;
    raw.path = request.url.split('?')[0];
    raw.ip = request.ip;
    raw.ips = request.ips?.slice(1).reverse() ?? [];
    raw.protocol = request.protocol;
    raw.hostname = request.hostname;
    raw.get = raw.header = (name: string) => {
      const lc = name.toLowerCase();
      if (lc === 'referer' || lc === 'referrer') return raw.headers.referrer || raw.headers.referer;
      return raw.headers[lc];
    };
  }
  // body may have been replaced by a previous middleware (e.g. validation) — keep both in sync
  if (raw.body === undefined) raw.body = request.body;
  return raw;
};

/** Copies what middleware changed on the legacy req back onto the Fastify request. */
const syncBack = (request: FastifyRequest, req: any) => {
  (request as any).body = req.body;
  (request as any).user = req.user;
};

/** Minimal Express `res` that records the response instead of writing it. */
const captureResponse = (done: (r: CapturedResponse) => void) => {
  const headers: Record<string, string> = {};
  let finished = false;
  const res: any = {
    statusCode: 200,
    headersSent: false,
    locals: {},
    status(code: number) { res.statusCode = code; return res; },
    set(field: any, value?: any) {
      if (typeof field === 'object') Object.entries(field).forEach(([k, v]) => res.set(k, v));
      else headers[String(field).toLowerCase()] = String(value);
      return res;
    },
    header(field: any, value?: any) { return res.set(field, value); },
    setHeader(field: string, value: any) { headers[field.toLowerCase()] = String(value); return res; },
    getHeader(field: string) { return headers[field.toLowerCase()]; },
    get(field: string) { return headers[field.toLowerCase()]; },
    removeHeader(field: string) { delete headers[field.toLowerCase()]; },
    type(t: string) { return res.set('content-type', t.includes('/') ? t : `application/${t}`); },
    json(body: unknown) {
      if (!headers['content-type']) headers['content-type'] = 'application/json; charset=utf-8';
      return finish(body === undefined ? '' : JSON.stringify(body));
    },
    send(body?: unknown) {
      if (body === null || body === undefined) return finish('');
      if (typeof body === 'string') {
        if (!headers['content-type']) headers['content-type'] = 'text/html; charset=utf-8';
        return finish(body);
      }
      if (Buffer.isBuffer(body)) {
        if (!headers['content-type']) headers['content-type'] = 'application/octet-stream';
        return finish(body);
      }
      if (typeof body === 'number') {
        // Express 4: res.send(status) (deprecated) sends the status text with that code
        res.statusCode = body;
        return res.send(require('http').STATUS_CODES[body] || String(body));
      }
      if (typeof body === 'boolean' || typeof body === 'object') return res.json(body);
      return finish(String(body));
    },
    sendStatus(code: number) {
      res.statusCode = code;
      return res.send(require('http').STATUS_CODES[code] || String(code));
    },
    end(chunk?: unknown) { return finish(chunk ?? ''); },
  };
  const finish = (body: unknown) => {
    if (!finished) {
      finished = true;
      res.headersSent = true;
      done({ status: res.statusCode, headers, body });
    }
    return res;
  };
  return res;
};

/** Runs middleware in order like Express does; stops at the first response or error. */
export const runLegacyMiddleware = async (
  request: FastifyRequest,
  chain: LegacyMiddleware[],
): Promise<MiddlewareOutcome> => {
  const req = legacyRequest(request);
  for (const mw of chain) {
    const outcome = await new Promise<MiddlewareOutcome>((resolve) => {
      const res = captureResponse((response) => resolve({ kind: 'response', response }));
      const next = (err?: unknown) => resolve(err ? { kind: 'error', error: err } : { kind: 'next' });
      try {
        const ret: any = mw(req, res, next);
        // Express 4 does not catch async rejections (the request would hang); surface them as errors.
        if (ret && typeof ret.catch === 'function') ret.catch((e: unknown) => resolve({ kind: 'error', error: e }));
      } catch (e) {
        resolve({ kind: 'error', error: e });
      }
    });
    syncBack(request, req);
    if (outcome.kind !== 'next') return outcome;
  }
  return { kind: 'next' };
};
