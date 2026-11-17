import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { legacyRequest } from './express-adapter';

/**
 * The Express-shaped request that legacy middleware populated (`req.user`, `req.companyId`,
 * `req.role`, `req.supportAgent`, `req.externalClient`, validated `req.body`, `req.query`, …).
 */
export const LegacyReq = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  legacyRequest(ctx.switchToHttp().getRequest<FastifyRequest>()),
);
