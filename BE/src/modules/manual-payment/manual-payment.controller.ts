import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  approveRevokePayment, createPaymentEntry, downloadInvoice, getAllPaymentRequest, downloadExcelSheet,
  exportAllPaymentRequest, getPendingPaymentCount,
} from '@legacy/controllers/ManualPayment/manualPayment.controller';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import { Post } from '../../core/http/routes';
import { AdminAuth, Legacy, SystemAdmin, adminAuth, authMiddleware } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/manualPayment/manualPayment.routes.ts (handlers delegated, 1,772 lines;
 * invoice/excel downloads stream through the hijacked raw response). Same middleware chains.
 * Note legacy GET /status (systemAdminAuth) approves/revokes a payment — a write on GET, kept.
 */
@Controller('api/manual-payment')
export class ManualPaymentController {
  @Post() @Legacy(adminAuth(['accounts::plan::edit']) as MW, authMiddleware as MW, fileUploader.single('file') as MW) create(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createPaymentEntry); }
  @Get('all') @SystemAdmin() all(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getAllPaymentRequest); }
  @Get('all/export') @SystemAdmin() exportAll(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, exportAllPaymentRequest); }
  @Get('status') @SystemAdmin() status(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, approveRevokePayment); }
  @Get('invoice') @Legacy(adminAuth(['accounts::purchase_history::view']) as MW, authMiddleware as MW) invoice(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, downloadInvoice); }
  @Get('system-admin/invoice') @SystemAdmin() sysInvoice(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, downloadInvoice); }
  @Get('excel') @AdminAuth(['accounts::purchase_history::view']) excel(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, downloadExcelSheet); }
  @Get('pending-count') @SystemAdmin() pending(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getPendingPaymentCount); }
}
