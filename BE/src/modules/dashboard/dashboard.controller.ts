import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  getCmsData, getDashboardInfo, getSystemAdminDashboardInfo, getCmsStatusCount, getSystemAdminDashboardCmsVms,
  getOrderStatusCount, masterImportCarrierReport, getCmsPlatformSummary, getVideoRecordingsByPlatform,
} from '@legacy/controllers/Dashboard/dashboard.controller';
import { getDashboardInsights } from '@legacy/controllers/Dashboard/insights.controller';
import { getCustomerCohorts } from '@legacy/controllers/Dashboard/customerCohorts.controller';
import { Post } from '../../core/http/routes';
import { Auth, SystemAdmin } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';

/**
 * Port of legacy routes/Dashboard/dashboard.routes.ts — 11 routes, same paths/methods/auth tiers.
 * Handlers DELEGATED to the legacy controllers (2,190 lines of aggregation + the insights cache);
 * see PROGRESS decisions. Note: `getCmsStatusCount` etc. keep their legacy camelCase paths.
 */
@Controller('api/dashboard')
export class DashboardController {
  @Get('cms-data') @Auth() cmsData(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCmsData); }
  @Get('cms-platform-summary') @Auth() cmsPlatformSummary(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCmsPlatformSummary); }
  @Get('video-recordings-by-platform') @Auth() videoByPlatform(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getVideoRecordingsByPlatform); }
  @Get() @Auth() info(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getDashboardInfo); }
  @Get('system-admin') @SystemAdmin() sysInfo(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getSystemAdminDashboardInfo); }
  @Post('system-admin/insights') @SystemAdmin() insights(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getDashboardInsights); }
  @Post('system-admin/customer-cohorts') @SystemAdmin() cohorts(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCustomerCohorts); }
  @Get('getCmsStatusCount') @Auth() cmsStatusCount(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCmsStatusCount); }
  @Get('getSystemAdminDashboardCmsVms') @SystemAdmin() sysCmsVms(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getSystemAdminDashboardCmsVms); }
  @Get('getOrderStatusCount') @Auth() orderStatusCount(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getOrderStatusCount); }
  @Get('masterImportCarrierReport') @Auth() carrierReport(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, masterImportCarrierReport); }
}
