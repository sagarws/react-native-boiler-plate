import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  activeDeActiveMasterImportUse, eComLoginInfoInsUp, markCredentialsUnverified, removeAjioAccount,
  scriptForAddKeysInSetting, syncSpfTatPeriodToCompanies,
} from '@legacy/controllers/MasterImportSetting/masterImportSetting.controller';
import { Post } from '../../core/http/routes';
import { AdminAuth, Auth, Legacy, authMiddleware, systemAdminAuth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/MasterImportSetting/MasterImportSetting.routes.ts (handlers delegated, 1,718 lines).
 * Legacy quirks kept: GET /add-keys-settings (any user) rewrites settings of every company;
 * POST /sync-spf-tat-to-companies chains systemAdminAuth + authMiddleware (no token passes both).
 */
@Controller('api/master-setting')
export class MasterImportSettingController {
  @Get('add-keys-settings') @Auth() addKeys(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, scriptForAddKeysInSetting); }
  @Get('active-deactive/:id') @Auth() activeDeactive(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, activeDeActiveMasterImportUse); }
  @Post('ecom-logininfo-insup') @AdminAuth(['integrations::view']) loginInfo(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, eComLoginInfoInsUp); }
  @Post('remove-ajio-account') @AdminAuth(['integrations::view']) removeAjio(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, removeAjioAccount); }
  @Post('mark-credentials-unverified') @Auth() unverified(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, markCredentialsUnverified); }
  @Post('sync-spf-tat-to-companies') @Legacy(systemAdminAuth as MW, authMiddleware as MW) syncSpf(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, syncSpfTatPeriodToCompanies); }
}
