import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { legacyRequest } from './express-adapter';

/**
 * The Express-shaped request that legacy middleware populated (`req.user`, `req.companyId`,
 * `req.role`, `req.file(s)`, validated `req.body`, `req.query`, `req.ip`, …).
 */
export const LegacyReq = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const http = ctx.switchToHttp();
  return legacyRequest(http.getRequest<FastifyRequest>(), http.getResponse<FastifyReply>());
});

/** The Express-shaped response (`res.status().json()` …). Using it means the handler writes the response itself. */
export const LegacyRes = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const http = ctx.switchToHttp();
  const req = legacyRequest(http.getRequest<FastifyRequest>(), http.getResponse<FastifyReply>());
  return req.res;
});
