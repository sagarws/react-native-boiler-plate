import type { FastifyReply, FastifyRequest } from 'fastify';
import finalhandler from 'finalhandler';
import { legacyRequest } from './express-adapter';

export type LegacyHandler = (req: any, res: any, next?: (err?: unknown) => void) => unknown;

/** Same message as legacy server.ts `process.on('unhandledRejection')`. */
export const logUnhandledRejection = (reason: unknown) => console.error('[UNHANDLED REJECTION]', reason);

/**
 * Hands the response to a handler written against Express `(req, res)` — delegated controllers,
 * SSE streams (`res.writeHead` + `res.write` + `req.on('close')`), `pipe(res)`, `res.download`,
 * `sendFile`, `redirect` (MIGRATION_PLAN §3 items 16–17, 23). The Fastify reply is hijacked, so
 * Fastify never writes; the handler sees Express's real req/res.
 *
 * Error behaviour is Express 4's, exactly:
 * - sync throw or next(err) → Express final handler (error page; if headers were already sent,
 *   finalhandler destroys the socket);
 * - next() with no error → no further route matches → 404 "Cannot METHOD /path" page;
 * - async rejection → Express 4 does NOT catch it: the request is left open (client times out) and
 *   legacy's process-level handler logs `[UNHANDLED REJECTION]`. Reproduced as-is.
 */
export const runLegacyHandler = async (request: FastifyRequest, reply: FastifyReply, handler: LegacyHandler): Promise<void> => {
  const req = legacyRequest(request, reply);
  const res = reply.raw;
  reply.hijack();
  const final = (err?: unknown) =>
    finalhandler(req, res, {
      env: process.env.NODE_ENV || 'development',
      onerror: (e: any) => process.env.NODE_ENV !== 'test' && console.error(e?.stack || String(e)),
    })(err as any);
  let ret: any;
  try {
    ret = handler(req, res, final);
  } catch (err) {
    final(err);
    return;
  }
  if (ret && typeof ret.then === 'function') {
    try {
      await ret;
    } catch (err) {
      logUnhandledRejection(err);
    }
  }
};
