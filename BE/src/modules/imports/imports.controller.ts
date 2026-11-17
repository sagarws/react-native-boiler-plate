import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { checkImportStatus, deleteOrder, downloadExcelSheet, getImportData, importData } from '@legacy/controllers/Imports/imports.controller';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import { Post } from '../../core/http/routes';
import { AdminAuth, Legacy, adminAuth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/Imports/imports.routes.ts (handlers delegated). The controller holds
 * BullMQ PRODUCERS (imports_queue, export_queue); legacy workers consume. GET /import-status/:jobId
 * is a public SSE stream polling the job hash in the shared Redis.
 */
@Controller('api/external-imports')
export class ImportsController {
  @Post('import') @Legacy(adminAuth(['external_imports::edit']) as MW, fileUploader.single('file') as MW) import(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, importData); }
  @Get('import') @AdminAuth(['external_imports::view']) list(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getImportData); }
  @Post('delete-import') @AdminAuth(['external_imports::edit']) remove(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deleteOrder); }
  @Get('import-status/:jobId') status(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, checkImportStatus); }
  @Get('excel') @AdminAuth(['external_imports::view']) excel(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, downloadExcelSheet); }
}
