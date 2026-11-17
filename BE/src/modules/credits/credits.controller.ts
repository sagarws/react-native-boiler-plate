import { Body, Controller, Put, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import Credit from '@legacy/models/Credits/credit.model';
import Plan from '@legacy/models/Plan/plan.model';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import { adminAuth, Legacy } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';
import type { LegacyMiddleware } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/Credits/credits.routes.ts.
 * LEGACY BUG kept for contract parity: the route passes the `adminAuth` FACTORY as middleware
 * (`authAdmin` instead of `authAdmin([...])`). It returns a function, never calls next() and never
 * responds, so every request hangs until the client times out. Same here (see PROGRESS "Legacy PRs").
 */
@Controller('api/credit')
export class CreditsController {
  @Put('upgrade-storage')
  @Legacy(adminAuth as unknown as LegacyMiddleware)
  async upgradeStorage(@LegacyReq() req: any, @Body() body: any, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { planId } = body;
      const user = req['user'];
      const { companyId } = user;
      const plan: any = await Plan.findById(planId);
      const currentCredit: any = await Credit.findOne({ companyId });

      if (currentCredit.remainingCredit < plan.price) {
        reply.status(SERVER_STATUS_CODE.BAD_REQUEST);
        return { isSuccess: false, message: SERVER_MESSAGE.INSUFFICIENT_CREDIT, displayMessage: SERVER_MESSAGE.INSUFFICIENT_CREDIT, data: null };
      }

      const updatedCredit = await Credit.findOneAndUpdate(
        { companyId },
        { $inc: { totalStorage: plan.storage, remainingStorage: plan.storage, totalCredit: -plan.price, remainingCredit: -plan.price } },
        { new: true },
      );

      if (!updatedCredit) {
        reply.status(SERVER_STATUS_CODE.NOT_FOUND);
        return { isSuccess: false, message: 'Credit not found', displayMessage: 'Cannot upgrade storage', data: null };
      }
      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return { isSuccess: true, message: 'Storage upgraded successfully', displayMessage: 'Storage upgraded successfully', data: updatedCredit };
    } catch (error) {
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER, data: null };
    }
  }
}
