import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { getProductDataByAWBNumber, addProductSkucodeMap, getProductSkucodeMap } from '@legacy/controllers/ProductSkucodeMap/productSkucodeMap.controller';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import { Post } from '../../core/http/routes';
import { Auth, Legacy, authMiddleware } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/ProductSkucodeMap/ProductSkucodeMap.routes.ts (handlers delegated).
 * The legacy controller creates a BullMQ PRODUCER (`ProductSkucodeMap_queue`); jobs are still
 * consumed by legacy's worker. Legacy quirk kept: POST / runs the upload BEFORE auth.
 */
@Controller('api/product-skucode-map')
export class ProductSkucodeMapController {
  @Post() @Legacy(fileUploader.fields([{ name: 'ProductSkucodeFile', maxCount: 1 }]) as MW, authMiddleware as MW) add(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, addProductSkucodeMap); }
  @Get(':awbNumber/:companyId') @Auth() byAwb(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getProductDataByAWBNumber); }
  @Post('all') @Auth() all(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getProductSkucodeMap); }
}
