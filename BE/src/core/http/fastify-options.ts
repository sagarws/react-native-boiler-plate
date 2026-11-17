import qs from 'qs';
import type { FastifyServerOptions } from 'fastify';

/** Express body-parser limit in legacy server.ts (json + urlencoded). */
export const BODY_LIMIT = 5 * 1024 * 1024;

/**
 * Express 4 `query parser: "extended"` default = qs.parse(str, { allowPrototypes: true, arrayLimit: 1000 }).
 * (express/lib/utils.js parseExtendedQueryString). Kept identical for compat item #1.
 */
export const parseQuery = (str: string): Record<string, unknown> =>
  qs.parse(str, { allowPrototypes: true, arrayLimit: 1000 }) as Record<string, unknown>;

/**
 * Malformed HTTP (parser errors, oversized headers, header timeout). Express adds no 'clientError'
 * listener, so legacy answers with Node's built-in raw responses (lib/_http_server.js
 * socketOnError) — status line only, empty body. Fastify's default sends a JSON body instead.
 */
export const nodeDefaultClientError = (err: NodeJS.ErrnoException, socket: import('net').Socket): void => {
  if (socket.writable && socket.bytesWritten === 0) {
    const status =
      err.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large'
      : err.code === 'HPE_CHUNK_EXTENSIONS_OVERFLOW' ? '413 Payload Too Large'
      : err.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? '408 Request Timeout'
      : '400 Bad Request';
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  }
  socket.destroy(err);
};

/**
 * Fastify options reproducing Express defaults (MIGRATION_PLAN §3 items 1, 2, 6, 13).
 */
export const fastifyOptions = (): FastifyServerOptions => ({
  bodyLimit: BODY_LIMIT,
  trustProxy: 'loopback', // app.set("trust proxy", "loopback")
  routerOptions: {
    ignoreTrailingSlash: true, // Express strict routing off
    caseSensitive: false, // Express case-insensitive routing
    querystringParser: parseQuery,
  },
  logger: false,
  clientErrorHandler: nodeDefaultClientError,
});
