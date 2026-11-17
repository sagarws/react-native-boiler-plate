import type { IncomingMessage, ServerResponse } from 'http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bodyParser from 'body-parser';
import cors from 'cors';
import etag from 'etag';
import finalhandler from 'finalhandler';
import fresh from 'fresh';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { BODY_LIMIT } from './fastify-options';

/**
 * Express-compatible request/response pipeline on Fastify (MIGRATION_PLAN §3 items 2–5, 11, 12).
 *
 * Instead of re-implementing Express behaviour, this runs the SAME middleware packages legacy
 * runs (legacy securityHeaders, cors, body-parser) on the raw Node req/res, in the same order as
 * legacy `server.ts`, and renders errors / 404s with the same `finalhandler` Express uses.
 * Fastify's own body parsers are removed, so the request stream is read only by body-parser.
 */

type ExpressMiddleware = (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void;

/** Same order as legacy server.ts: securityHeaders → cors() → urlencoded → json. */
export const legacyMiddlewareChain = (): ExpressMiddleware[] => [
  securityHeaders as unknown as ExpressMiddleware,
  cors() as unknown as ExpressMiddleware,
  bodyParser.urlencoded({ extended: true, limit: '5mb' }) as unknown as ExpressMiddleware,
  // express.json({ limit: "5mb" }) === bodyParser.json({ limit: "5mb" }) in Express 4
  bodyParser.json({ limit: '5mb' }) as unknown as ExpressMiddleware,
];

const expressEnv = () => process.env.NODE_ENV || 'development';

/** Express app `logerror`: prints the stack unless env is "test". */
const logError = (err: any) => {
  if (expressEnv() !== 'test') console.error(err?.stack || String(err));
};

/** Moves headers queued on the Fastify reply onto the raw response before we write to it directly. */
const flushReplyHeaders = (reply: FastifyReply) => {
  const headers = reply.getHeaders();
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !reply.raw.headersSent) reply.raw.setHeader(name, value as any);
  }
};

/**
 * Ends the request the way Express's final handler would: `err` → error page (status from
 * err.status / err.statusCode, "Bad Request" etc. in production, stack otherwise), no err → 404
 * "Cannot METHOD /path".
 */
export const sendExpressFinal = (request: FastifyRequest, reply: FastifyReply, err?: unknown): void => {
  reply.hijack();
  flushReplyHeaders(reply);
  finalhandler(request.raw, reply.raw, { env: expressEnv(), onerror: logError })(err as any);
};

const runChain = (chain: ExpressMiddleware[], req: IncomingMessage, res: ServerResponse) =>
  new Promise<{ err?: unknown; ended: boolean }>((resolve) => {
    let i = 0;
    const next = (err?: unknown) => {
      if (err) return resolve({ err, ended: false });
      if (res.writableEnded) return resolve({ ended: true });
      const mw = chain[i++];
      if (!mw) return resolve({ ended: false });
      try {
        mw(req, res, next);
        // cors preflight ends the response synchronously without calling next()
        if (res.writableEnded) resolve({ ended: true });
      } catch (e) {
        resolve({ err: e, ended: false });
      }
    };
    next();
  });

/** Express res.send ETag + freshness (weak ETag via `etag`, 304 via `fresh`) for string/Buffer bodies. */
const etagOnSend = async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
  if (!reply.hasHeader('etag')) reply.header('ETag', etag(Buffer.isBuffer(payload) ? payload : Buffer.from(payload), { weak: true }));

  const method = request.raw.method;
  const status = reply.statusCode;
  const isFresh =
    (method === 'GET' || method === 'HEAD' || method === 'QUERY') &&
    ((status >= 200 && status < 300) || status === 304) &&
    fresh(request.headers as any, {
      etag: reply.getHeader('etag') as string,
      'last-modified': reply.getHeader('last-modified') as string,
    });
  if (isFresh) reply.code(304);
  if (reply.statusCode === 204 || reply.statusCode === 304) {
    reply.removeHeader('content-type');
    reply.removeHeader('content-length');
    reply.removeHeader('transfer-encoding');
    return null; // null (not '') so Fastify adds no content-length, like Express
  }
  return payload;
};

export const registerExpressCompat = (fastify: FastifyInstance): void => {
  const chain = legacyMiddlewareChain();

  fastify.addHook('onRequest', async (request, reply) => {
    const { err, ended } = await runChain(chain, request.raw, reply.raw);
    if (ended) return reply.hijack();
    if (err) return sendExpressFinal(request, reply, err);
  });

  // body-parser already consumed the stream; hand its result to Fastify/Nest.
  fastify.removeAllContentTypeParsers();
  fastify.addContentTypeParser('*', (request, _payload, done) => done(null, (request.raw as any).body));
  fastify.addHook('preValidation', async (request) => {
    if (request.body === undefined) (request as any).body = (request.raw as any).body;
  });

  fastify.addHook('onSend', etagOnSend);
};

export { BODY_LIMIT };
