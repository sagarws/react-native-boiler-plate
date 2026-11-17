import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import ClaimHistory from '@legacy/models/ClaimHistory/claimHistory.model';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import { AdminAuth } from '../../core/auth';

/** Port of legacy routes/ClaimHistory/claimHistory.route.ts. Query by `_id` (primary key). */
@Controller('api/claim-history')
export class ClaimHistoryController {
  @Get(':id')
  @AdminAuth(['cms::view'])
  async getClaimHistoryById(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      if (!mongoose.isValidObjectId(id)) {
        reply.status(SERVER_STATUS_CODE.SUCCESS);
        return {
          isSuccess: true,
          data: null,
          message: SERVER_MESSAGE.CLAIM_HISTORY_NOT_FOUND,
          displayMessage: SERVER_MESSAGE.CLAIM_HISTORY_NOT_FOUND,
        };
      }

      const claimHistory = await ClaimHistory.findOne({ _id: id })
        .populate({ path: 'history.user', select: 'name.fullName email', strictPopulate: false })
        .populate({ path: 'history.feed', select: 'feedName', strictPopulate: false });

      if (!claimHistory) {
        reply.status(SERVER_STATUS_CODE.SUCCESS);
        return { isSuccess: false, message: SERVER_MESSAGE.CLAIM_HISTORY_NOT_FOUND, displayMessage: SERVER_MESSAGE.CLAIM_HISTORY_NOT_FOUND };
      }

      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return { isSuccess: true, message: SERVER_MESSAGE.CLAIM_HISTORY_FOUND, displayMessage: SERVER_MESSAGE.CLAIM_HISTORY_FOUND, data: claimHistory };
    } catch (error) {
      reply.status(500);
      return { message: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }
}
