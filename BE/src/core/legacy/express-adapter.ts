import express from 'express';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Runs legacy Express middleware `(req, res, next)` on a Fastify request.
 *
 * Exactly like Express's own `expressInit`, the raw Node req/res get Express's request/response
 * prototypes (from an Express app configured like legacy server.ts). So `res.status().json()`,
 * `res.send()`, `req.ip` (trust proxy = loopback), `req.get()`, `res.on('finish')` … are the real
 * Express implementations, and whatever a middleware writes is byte-identical to legacy.
 * Fastify's own methods live on FastifyRequest/FastifyReply and are not affected.
 *
 * Properties a middleware sets on `req` (`user`, `companyId`, `role`, `file`, `files`,
 * `supportAgent`, `externalClient`, validated `body` …) stay on it for later middleware and for
 * the handler (`@LegacyReq()`).
 */

export type LegacyMiddleware = (req: any, res: any, next: (err?: unknown) => void) => unknown;

export type MiddlewareOutcome =
  | { kind: 'next' }
  | { kind: 'error'; error: unknown }
  | { kind: 'responded' };

/** Settings-only Express app: provides req/res prototypes with legacy's app settings. Never listens. */
export const legacyExpressApp = express();
legacyExpressApp.set('trust proxy', 'loopback');
legacyExpressApp.disable('x-powered-by');

const INIT = Symbol('legacyExpressInit');

/** Express-shaped view of the request (one per request, shared by all middleware + handler). */
export const legacyRequest = (request: FastifyRequest, reply?: FastifyReply): any => {
  const req: any = request.raw;
  if (!req[INIT]) {
    req[INIT] = true;
    const res: any = reply?.raw ?? (request as any).__legacyRes;
    req.res = res;
    if (res) {
      res.req = req;
      Object.setPrototypeOf(res, legacyExpressApp.response);
      res.locals = res.locals || Object.create(null);
    }
    Object.setPrototypeOf(req, legacyExpressApp.request);
    req.originalUrl = req.url;
    req.baseUrl = '';
    req.query = request.query ?? {};
    req.params = request.params ?? {};
  }
  if (req.body === undefined) req.body = request.body;
  return req;
};

/** Copies what middleware changed on the legacy req back onto the Fastify request. */
const syncBack = (request: FastifyRequest, req: any) => {
  (request as any).body = req.body;
  (request as any).user = req.user;
};

/** Runs middleware in order like Express; stops at the first response or error. */
export const runLegacyMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply,
  chain: LegacyMiddleware[],
): Promise<MiddlewareOutcome> => {
  const req = legacyRequest(request, reply);
  const res = reply.raw;
  for (const mw of chain) {
    const outcome = await new Promise<MiddlewareOutcome>((resolve) => {
      let settled = false;
      const settle = (o: MiddlewareOutcome) => {
        if (settled) return;
        settled = true;
        res.off('finish', onEnd);
        res.off('close', onEnd);
        resolve(o);
      };
      const onEnd = () => settle({ kind: 'responded' });
      res.once('finish', onEnd);
      res.once('close', onEnd);
      const next = (err?: unknown) => settle(err ? { kind: 'error', error: err } : { kind: 'next' });
      req.next = next;
      try {
        const ret: any = mw(req, res, next);
        // Express 4 doesn't catch async rejections: the request stays open and legacy's process
        // handler logs it. Same here (the guard never settles).
        if (ret && typeof ret.catch === 'function') ret.catch((e: unknown) => console.error('[UNHANDLED REJECTION]', e));
      } catch (e) {
        settle({ kind: 'error', error: e });
      }
    });
    syncBack(request, req);
    if (outcome.kind === 'responded') reply.hijack();
    if (outcome.kind !== 'next') return outcome;
  }
  return { kind: 'next' };
};
