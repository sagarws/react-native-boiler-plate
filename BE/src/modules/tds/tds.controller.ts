import { Controller, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { createTDS, getTDS, getAllTDSForSystemAdmin, UpdateTDSDetailsBySuperAdmin, CloseTDSRequestBySuperAdmin } from '@legacy/controllers/TDS/tds.controller';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import { createTDSSchema, updateTDSBySystemAdminSchema } from '@legacy/validations/TDS/tds.validation';
import validateRequest from '@legacy/utils/validateRequest';
import { Post } from '../../core/http/routes';
import { Auth, Legacy, SystemAdmin, authMiddleware, systemAdminAuth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

const uploadMiddleware = fileUploader.single('file') as MW;

/** Port of legacy routes/TDS/tds.routes.ts (handlers delegated; same chains: auth → upload → validation). */
@Controller('api/tds')
export class TdsController {
  @Post('create') @Legacy(authMiddleware as MW, uploadMiddleware, validateRequest(createTDSSchema) as MW) create(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createTDS); }
  @Post() @Auth() list(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getTDS); }
  @Post('super_admin') @SystemAdmin() listAll(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getAllTDSForSystemAdmin); }
  @Post('update/super_admin') @Legacy(systemAdminAuth as MW, uploadMiddleware, validateRequest(updateTDSBySystemAdminSchema) as MW) update(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, UpdateTDSDetailsBySuperAdmin); }
  @Put('close-tds-request') @SystemAdmin() close(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, CloseTDSRequestBySuperAdmin); }
}
