import type { FastifyReply, FastifyRequest } from 'fastify';
import { LegacyHandler, runLegacyHandler } from './run-legacy-handler';

/**
 * Body of a Nest route whose handler is the legacy Express controller function (delegation rule,
 * PROGRESS decisions 2026-11-17). Guards (auth tiers) still run first, in Nest.
 *
 *   @Get('x') @Auth()
 *   x(@Req() req: FastifyRequest, @Res() reply: FastifyReply) { return delegate(req, reply, legacyX); }
 */
export const delegate = (req: FastifyRequest, reply: FastifyReply, handler: LegacyHandler) => runLegacyHandler(req, reply, handler);
