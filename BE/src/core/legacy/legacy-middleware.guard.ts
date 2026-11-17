import { applyDecorators, CanActivate, ExecutionContext, Injectable, mixin, Type, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LegacyMiddleware, runLegacyMiddleware } from './express-adapter';

/** Thrown when a legacy middleware already wrote the response; the global filter ignores it. */
export class ResponseAlreadySent extends Error {
  constructor() { super('response already sent by legacy middleware'); }
}

/**
 * Guard that runs a legacy middleware chain (e.g. `[systemAdminAuth, adminOnly]`) exactly as the
 * legacy route did. If the chain answers (401/403/422/429 …) that answer has been written by
 * Express's own response code; if it calls next(err) the error goes to the Express final handler.
 */
export const LegacyMiddlewareGuard = (...chain: LegacyMiddleware[]): Type<CanActivate> => {
  @Injectable()
  class Guard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const http = context.switchToHttp();
      const outcome = await runLegacyMiddleware(http.getRequest<FastifyRequest>(), http.getResponse<FastifyReply>(), chain);
      if (outcome.kind === 'next') return true;
      if (outcome.kind === 'error') throw outcome.error;
      throw new ResponseAlreadySent();
    }
  }
  return mixin(Guard);
};

/** `@Legacy(mw1, mw2)` ≙ `router.get(path, mw1, mw2, handler)` — same order as the legacy route. */
export const Legacy = (...chain: LegacyMiddleware[]) => applyDecorators(UseGuards(LegacyMiddlewareGuard(...chain)));
