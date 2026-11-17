import type { FastifyReply, FastifyRequest } from 'fastify';
import finalhandler from 'finalhandler';
import { legacyRequest } from './express-adapter';

export type LegacyHandler = (req: any, res: any, next?: (err?: unknown) => void) => unknown;

/**
 * Hands the response to a handler written against Express `(req, res)` — SSE streams
 * (`res.writeHead` + `res.write` + `req.on('close')`), `pipe(res)`, `res.download`, `sendFile`,
 * `redirect` (MIGRATION_PLAN §3 items 16–17). The Fastify reply is hijacked, so Fastify never
 * writes; the handler sees Express's real req/res. Error behaviour matches Express 4:
 * a sync throw or next(err) → final handler page; an async rejection is logged (Express would
 * leave the request hanging; we end it with the same final-handler page instead).
 * Returns once the handler's promise settles (streams keep running after that).
 */
export const runLegacyHandler = async (request: FastifyRequest, reply: FastifyReply, handler: LegacyHandler): Promise<void> => {
  const req = legacyRequest(request, reply);
  const res = reply.raw;
  reply.hijack();
  const fail = (err: unknown) => {
    if (res.headersSent) {
      console.error(err);
      if (!res.writableEnded) res.end();
      return;
    }
    finalhandler(req, res, {
      env: process.env.NODE_ENV || 'development',
      onerror: (e: any) => process.env.NODE_ENV !== 'test' && console.error(e?.stack || String(e)),
    })(err as any);
  };
  const next = (err?: unknown) => fail(err); // next() after a handler = no further route → 404 page
  try {
    await handler(req, res, next);
  } catch (err) {
    fail(err);
  }
};
