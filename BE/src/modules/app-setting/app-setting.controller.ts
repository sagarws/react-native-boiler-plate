import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { addUpdateAppSetting, getAppSetting, getAppSettingForAdmin, getClaimTypes, upsertIncreffQcMapping } from '@legacy/controllers/AppSetting/appSetting.controller';
import { Post } from '../../core/http/routes';
import { AdminAuth, Auth, Legacy, SystemAdmin, authMiddleware, systemAdminAuth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/** Port of legacy routes/AppSetting/appSetting.route.ts (handlers delegated; same middleware chains). */
@Controller('api/app-settings')
export class AppSettingController {
  @Get() @SystemAdmin() get(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getAppSetting); }
  @Post() @SystemAdmin() upsert(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, addUpdateAppSetting); }
  @Get('get-app-setting-for-admin') @AdminAuth(['settings::view']) forAdmin(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getAppSettingForAdmin); }
  @Get('claim-types') @Auth() claimTypes(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getClaimTypes); }
  @Post('increff-qc-mapping') @Legacy(authMiddleware as MW, systemAdminAuth as MW) qc(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, upsertIncreffQcMapping); }
}
