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
/** separate instance for requests Fastify rejects before routing (see expressFrameworkErrors) */
let frameworkChain: ExpressMiddleware[] = [];

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
  frameworkChain = legacyMiddlewareChain();

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

/**
 * Fastify `frameworkErrors`: malformed percent-escapes make Fastify reject the URL before routing
 * (FST_ERR_BAD_URL, JSON body). Express matches routes on the raw path and only decodes PARAMS:
 * a bad escape inside a param → 400 URIError final-handler page; anywhere else → no match → the
 * 404 "Cannot METHOD /path" page. Reproduced by looking the route up with the bad escapes made
 * valid ("%" → "%25").
 */
export const expressFrameworkErrors = async (error: any, request: FastifyRequest, reply: FastifyReply): Promise<void> => {
  // Fastify calls this before onRequest hooks; Express would already have run the app-level
  // middleware (security headers, cors, body parsers) before routing.
  const { err: mwErr, ended } = await runChain(frameworkChain, request.raw, reply.raw);
  if (ended) return void reply.hijack();
  if (mwErr) return sendExpressFinal(request, reply, mwErr);
  if (error?.code !== 'FST_ERR_BAD_URL') {
    sendExpressFinal(request, reply, error);
    return;
  }
  const rawPath = (request.raw.url || '').split('?')[0];
  const fixed = rawPath.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
  let found: any = null;
  try {
    found = (request.server as any).findRoute({ method: request.raw.method, url: fixed });
  } catch {
    found = null;
  }
  const badParam = found && Object.values(found.params || {}).find((v: any) => typeof v === 'string' && /%(?![0-9A-Fa-f]{2})/.test(v));
  if (!badParam) {
    sendExpressFinal(request, reply); // 404 Cannot METHOD /path
    return;
  }
  const err: any = new URIError(`Failed to decode param '${badParam}'`);
  err.status = err.statusCode = 400;
  sendExpressFinal(request, reply, err);
};
