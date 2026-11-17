import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import authMiddleware from '@legacy/middleware/authentication.middleware';
import adminAuth from '@legacy/middleware/adminAuth.middleware';
import { MasterImportOrderReports, OrderDataImport, UpdateMasterImportOrderReports } from '@legacy/controllers/MasterImport/masterImportOrderReports.controller';
import { WhatsappDataImport, downloadWhatsAppSample, retryAllD2CWhatsAppMessages } from '@legacy/controllers/WhatsappDataImport/whatsappDataImport.controller';
import { importData } from '@legacy/controllers/Imports/imports.controller';
import { addProductSkucodeMap } from '@legacy/controllers/ProductSkucodeMap/productSkucodeMap.controller';
import {
  MasterImportOrderReportsV2, UpdateMasterImportOrderReportsV2, OrderDataImportV2, ScanReturnParcelV2, CheckMultipleSkuOrQtyV2, UpdateReturnQuantitiesV2,
} from '@legacy/v2/masterImport/controllers/import.controller';
import { MeeshoMasterImportV2 } from '@legacy/v2/masterImport/controllers/meeshoImport.controller';
import { SnapdealMasterImportV2 } from '@legacy/v2/masterImport/controllers/snapdealImport.controller';
import { MyntraMasterImportV2, MyntraScanVideoImportV2 } from '@legacy/v2/masterImport/controllers/myntraImport.controller';
import { Post } from '../core/http/routes';
import { Legacy } from '../core/auth';
import { delegate } from '../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../core/legacy/express-adapter';

const auth = authMiddleware as MW;
const dropship = fileUploader.fields([{ name: 'DropshipOrderFile', maxCount: 1 }, { name: 'DropshipRtvFile', maxCount: 1 }, { name: 'DropshipFile', maxCount: 1 }]) as MW;
const single = (f: string) => fileUploader.single(f) as MW;
const fields1 = (f: string) => fileUploader.fields([{ name: f, maxCount: 1 }]) as MW;

/**
 * Port of the routes declared inline in legacy src/MasterImportServer.ts (same paths, same
 * middleware chains, handlers delegated). Not included: bull-board at /admin/queues.
 */
@Controller()
export class MasterImportServerController {
  @Get() @Header('Content-Type', 'text/html; charset=utf-8') root() { return 'Hello World!, this is the Master Server!'; }
  @Get('health') @Header('Content-Type', 'text/html; charset=utf-8') health() { return 'Hello Home'; }
  @Post('api/master/masterImportOrderReports') @Legacy(auth, dropship) a(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, MasterImportOrderReports); }
  @Post('api/master/updateMasterImportOrderReports') @Legacy(auth, single('UpdateRtv')) b(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, UpdateMasterImportOrderReports); }
  @Post('api/master/orderDataImport') @Legacy(auth, fields1('OrderDataFile')) c(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, OrderDataImport); }
  @Post('api/master/whatsappNumberImport') @Legacy(auth, fields1('WhatsAppNumberFile')) d(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, WhatsappDataImport); }
  @Get('api/master/whatsappNumberSample') @Legacy(auth) e(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, downloadWhatsAppSample); }
  @Post('api/d2c/whatsapp/retry-all') @Legacy(auth) f(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, retryAllD2CWhatsAppMessages); }
  @Post('api/v2/master/import') @Legacy(auth, dropship) g(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, MasterImportOrderReportsV2); }
  @Post('api/v2/meesho-master/import') @Legacy(auth, single('file')) h(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, MeeshoMasterImportV2); }
  @Post('api/v2/snapdeal-master/import') @Legacy(auth, single('file')) i(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, SnapdealMasterImportV2); }
  @Post('api/v2/myntra-master/import') @Legacy(auth, single('file')) j(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, MyntraMasterImportV2); }
  @Post('api/v2/myntra-master/scan-video-import') @Legacy(auth, single('file')) k(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, MyntraScanVideoImportV2); }
  @Post('api/v2/master/import/update-rtv') @Legacy(auth, single('UpdateRtv')) l(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, UpdateMasterImportOrderReportsV2); }
  @Post('api/v2/master/import/order-data') @Legacy(auth, fields1('OrderDataFile')) m(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, OrderDataImportV2); }
  @Post('api/v2/master/scan-return-parcel') @Legacy(auth) n(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, ScanReturnParcelV2); }
  @Post('api/v2/master/checkMultipleSkuOrQty') @Legacy(auth) o(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, CheckMultipleSkuOrQtyV2); }
  @Post('api/v2/master/updateReturnQuantities') @Legacy(auth) p(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, UpdateReturnQuantitiesV2); }
  @Post('api/external-imports/import') @Legacy(adminAuth(['external_imports::edit']) as MW, single('file')) q(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, importData); }
  @Post('api/product-skucode-map') @Legacy(auth, fields1('ProductSkucodeFile')) s(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, addProductSkucodeMap); }
}
