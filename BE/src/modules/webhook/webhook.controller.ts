import { Controller, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { providerWebhookHandler, outlookWebhookHandler, registerWebhookCallback } from '@legacy/controllers/Webhook/webhook.controller';
import { Post } from '../../core/http/routes';
import { delegate } from '../../core/legacy/delegate';

/**
 * Port of legacy routes/Webhook/webhook.routes.ts — public provider callbacks (Gmail Pub/Sub,
 * Outlook Graph validation). Handlers delegated; realtime emits are forwarded to legacy's
 * /internal/realtime/broadcast (REALTIME_INTERNAL_URL) because this process owns no sockets.
 */
@Controller('api/webhooks')
export class WebhookController {
  @Post('provider') provider(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, providerWebhookHandler); }
  @Post('outlook') outlook(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, outlookWebhookHandler); }
  @Post('register') register(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, registerWebhookCallback); }
}
