import { applyDecorators, CanActivate, ExecutionContext, Injectable, mixin, Type, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { LegacyResponseException } from '../errors/legacy-response.exception';
import { LegacyMiddleware, runLegacyMiddleware } from './express-adapter';

/**
 * Guard that runs a legacy middleware chain (e.g. `[systemAdminAuth, adminOnly]`) exactly as the
 * legacy route did. If the chain answers (401/403/422 …) that answer is sent verbatim; if it
 * calls next(err) the error goes to the Express-style final handler.
 */
export const LegacyMiddlewareGuard = (...chain: LegacyMiddleware[]): Type<CanActivate> => {
  @Injectable()
  class Guard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<FastifyRequest>();
      const outcome = await runLegacyMiddleware(request, chain);
      if (outcome.kind === 'next') return true;
      if (outcome.kind === 'error') throw outcome.error;
      const { status, headers, body } = outcome.response;
      throw new LegacyResponseException(status, body, headers);
    }
  }
  return mixin(Guard);
};

/** `@Legacy(authMiddleware)` ≙ `router.get(path, authMiddleware, handler)` — same order as the legacy route. */
export const Legacy = (...chain: LegacyMiddleware[]) => applyDecorators(UseGuards(LegacyMiddlewareGuard(...chain)));
