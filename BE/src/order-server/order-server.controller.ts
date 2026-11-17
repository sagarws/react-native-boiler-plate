import { Controller, Delete, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { fileUploader } from '@legacy/OrderServer/middleware/fileuploader.middleware';
import { cloudProcessedOrder, createOrder, createOrderV2, deleteFile, getFeedSettings, getFile, getUploadUrl } from '@legacy/OrderServer/controller/file.controller';
import authMiddleware from '@legacy/OrderServer/middleware/authentication.middleware';
import { useCredits } from '@legacy/OrderServer/middleware/creditValidator';
import { Post } from '../core/http/routes';
import { Legacy } from '../core/auth';
import { delegate } from '../core/legacy/delegate';
import { applyExpressWildcard } from '../core/http/express-wildcard';
import { sendExpressFinal } from '../core/http/express-compat';
import type { LegacyMiddleware as MW } from '../core/legacy/express-adapter';

const uploadMiddleware = fileUploader.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files' },
]) as MW;

/**
 * Port of legacy OrderServer/routes/file.route.ts (mounted at /order on the OrderServer process).
 * Uses the OrderServer's OWN auth middleware (OrderServer/middleware/authentication.middleware)
 * and credit validator, in the same order. Handlers delegated. The OrderServer's workers
 * (orderWorker, whatsappWorker) are NOT imported — they keep running in legacy until Phase 6.
 */
@Controller('order')
export class OrderServerController {
  @Post('create-order') @Legacy(authMiddleware as MW, useCredits as MW, uploadMiddleware) createOrder(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createOrder); }
  @Post('get-upload-url') @Legacy(authMiddleware as MW) uploadUrl(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getUploadUrl); }
  @Post('create-order-v2') @Legacy(authMiddleware as MW, useCredits as MW, uploadMiddleware) createOrderV2(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createOrderV2); }
  /** legacy `/view/:key(*)`: needs the slash after /view; bare /order/view matches no route → 404 page */
  @Get(['view', 'view/*']) view(@Req() q: Rq, @Res() r: Reply) {
    const pathname = (q.raw.url || '').split('?')[0];
    if (pathname.length === '/order/view'.length) return sendExpressFinal(q, r);
    return applyExpressWildcard(q, r, '/order/view') ? delegate(q, r, getFile) : undefined;
  }
  @Delete('delete') @Legacy(authMiddleware as MW) remove(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deleteFile); }
  @Post('cloud-processed') cloudProcessed(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, cloudProcessedOrder); }
  @Post('get-feed-settings') feedSettings(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getFeedSettings); }
}
