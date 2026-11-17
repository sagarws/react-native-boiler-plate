import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  addStorageHistory,
  getCompanyFeedDetails,
  getCompanyOverview,
} from '@legacy/controllers/StorageHistory/storageHistory.controller';
import { Post } from '../../core/http/routes';
import { SystemAdmin } from '../../core/auth';
import { runLegacyHandler } from '../../core/legacy/run-legacy-handler';

/**
 * Port of legacy routes/StorageHistory/storageHistory.routes.ts.
 *
 * DELEGATED handlers (decision 2026-11-17): the logic lives in ~800 lines of non-exported
 * aggregation helpers inside the legacy controller. Copying them would fork the code; extracting
 * them into a service needs a legacy PR (user approval). Until then the routes, guards and
 * HTTP layer are Nest/Fastify and the handler body runs the legacy function on Express req/res.
 *
 * LEGACY RISK kept for contract parity (flagged in PROGRESS.md): GET /add-storage-history has no
 * auth and rebuilds storage history for all companies' orders; its catch does not respond.
 */
@Controller('api/storage-history')
export class StorageHistoryController {
  @Post()
  @SystemAdmin()
  overview(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return runLegacyHandler(req, reply, getCompanyOverview);
  }

  @Post('feed')
  @SystemAdmin()
  feed(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return runLegacyHandler(req, reply, getCompanyFeedDetails);
  }

  @Get('add-storage-history')
  addStorageHistory(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    return runLegacyHandler(req, reply, addStorageHistory);
  }
}
