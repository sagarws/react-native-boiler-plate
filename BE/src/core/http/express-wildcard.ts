import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendExpressFinal } from './express-compat';

/**
 * Express 4 `/:key(*)` params, rebuilt from the raw URL (Fastify's `*` param decodes and matches
 * differently). Express gives `{ '0': rest, key: rest }`, decodes with decodeURIComponent (so
 * `%2F` → `/`), and answers a malformed escape with a 400 URIError final-handler page.
 *
 * `prefix` is the route path before the wildcard, e.g. '/api/files/get-file-link'.
 * Returns false when it already answered (bad encoding).
 */
export const applyExpressWildcard = (request: FastifyRequest, reply: FastifyReply, prefix: string, name = 'key'): boolean => {
  const pathname = (request.raw.url || '').split('?')[0];
  // case-insensitive routing: strip by length, not by string compare
  let rest = pathname.length > prefix.length ? pathname.slice(prefix.length) : '';
  if (rest.startsWith('/')) rest = rest.slice(1);
  let value: string;
  try {
    value = rest.length ? decodeURIComponent(rest) : rest;
  } catch (e: any) {
    const err: any = e instanceof URIError ? e : new URIError(String(e));
    err.message = `Failed to decode param '${rest}'`;
    err.status = err.statusCode = 400;
    sendExpressFinal(request, reply, err);
    return false;
  }
  (request as any).params = { '0': value, [name]: value };
  return true;
};
