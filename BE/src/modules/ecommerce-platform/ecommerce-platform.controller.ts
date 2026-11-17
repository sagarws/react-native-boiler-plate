import { Controller, Delete, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { createECommercePlatform, deleteECommercePlatform, getECommercePlatforms, storeLogo, updateECommercePlatform } from '@legacy/controllers/eCommercePlatform/eCommercePlatform.controller';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import { Post } from '../../core/http/routes';
import { Auth, Legacy, authMiddleware } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

const uploadMiddleware = fileUploader.fields([{ name: 'logo', maxCount: 1 }]) as MW;

/** Port of legacy routes/eCommercePlatform/eCommercePlatform.routes.ts (handlers delegated). */
@Controller('api/ecommerce-platform')
export class ECommercePlatformController {
  @Post('create-ecommerce-platform') @Auth() create(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createECommercePlatform); }
  @Post('store-logo') @Legacy(authMiddleware as MW, uploadMiddleware) logo(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, storeLogo); }
  @Get() @Auth() list(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getECommercePlatforms); }
  @Post('update/:id') @Auth() update(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateECommercePlatform); }
  @Delete('delete') @Auth() remove(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deleteECommercePlatform); }
}
