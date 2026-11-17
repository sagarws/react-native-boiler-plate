import { Controller, Get, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { getCompanyInfo, scriptForUpDaysInSetting, updateCompanyClaims, updateIncreffAllocation } from '@legacy/controllers/Company/company.controller';
import { Auth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';

/**
 * Port of legacy routes/Company/company.routes.ts (handlers delegated).
 * ⚠ LEGACY RISK kept for contract parity (PROGRESS "Legacy PRs"):
 * - PUT /update-claims has NO auth and rewrites typeOfClaims for every company.
 * - GET /update-settings (any logged-in user) resets tatPeriod for every company.
 */
@Controller('api/companies')
export class CompanyController {
  @Get() @Auth() info(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCompanyInfo); }
  @Get('update-settings') @Auth() updDays(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, scriptForUpDaysInSetting); }
  @Put('update-claims') updClaims(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateCompanyClaims); }
  @Put('increff-allocation') @Auth() increff(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateIncreffAllocation); }
}
