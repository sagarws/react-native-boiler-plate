import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Credit from '@legacy/models/Credits/credit.model';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import { Auth } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';

/** Port of legacy routes/Account/account.routes.ts. Query `{ companyId }` on Credit (unchanged). */
@Controller('api/account')
export class AccountController {
  @Get('usage')
  @Auth()
  async getUsages(@LegacyReq() req: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const user = req['user'];
      const usages: any = await Credit.findOne({ companyId: user.companyId });
      const data = {
        storage: { used: usages.usedStorage, total: usages.totalStorage, remaining: usages.remainingStorage },
        credit: { used: usages.usedCredit, total: usages.totalCredit, remaining: usages.remainingCredit },
      };
      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return { isSuccess: true, message: SERVER_MESSAGE.FETCHED, displayMessage: SERVER_MESSAGE.FETCHED, data };
    } catch (error) {
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      // legacy sends the Error object itself as `message` (serializes to {})
      return { isSuccess: false, message: error, displayMessage: SERVER_MESSAGE.USAGE_ERROR, data: null };
    }
  }
}
