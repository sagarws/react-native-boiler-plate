import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sendExpressFinal } from '../http/express-compat';
import { LegacyResponseException } from './legacy-response.exception';

/**
 * Replaces Nest's `{ statusCode, message, error }` error body (MIGRATION_PLAN §3 items 5, 9, 23).
 * - LegacyResponseException → its exact status/body.
 * - Unmatched route → Express's "Cannot GET /x" 404 page.
 * - Anything else that escaped a handler → Express final handler (500 HTML, like a sync throw in Express).
 *   Ported handlers keep legacy try/catch blocks, so this is the fallback only.
 */
@Catch()
export class LegacyExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    if (reply.sent || reply.raw.headersSent) return;

    if (exception instanceof LegacyResponseException) {
      reply.headers(exception.headers).status(exception.status).send(exception.body);
      return;
    }
    if (!request.routeOptions?.url) {
      sendExpressFinal(request, reply);
      return;
    }
    const err: any = exception instanceof Error ? exception : new Error(String(exception));
    // Nest HttpExceptions carry the status in getStatus(); finalhandler reads err.status.
    if (typeof err.getStatus === 'function' && err.status === undefined) err.status = err.getStatus();
    sendExpressFinal(request, reply, err);
  }
}
