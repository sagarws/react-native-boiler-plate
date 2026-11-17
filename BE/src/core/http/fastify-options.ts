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
});
