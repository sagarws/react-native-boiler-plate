import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import BaseLinkOrders from '@legacy/models/BaseLinkOrders/baseLinkOrders.model';
import { SERVER_MESSAGE } from '@legacy/enum/response.enum';

/**
 * Port of legacy routes/BaseLink/base-link.routes.ts.
 * NOTE (legacy contract, kept as-is): unauthenticated GET that inserts a BaseLinkOrders document.
 * Insert only, no query → no index needed.
 */
@Controller('api/base-link')
export class BaseLinkController {
  /** legacy: controllers/BaseLink/base-link.controller.ts → getBaseLinkOrderInfo */
  @Get(':orderId/:awbNumber/:fieldId')
  async getBaseLinkOrderInfo(@Param() params: Record<string, string>, @Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const { orderId, awbNumber, fieldId } = params;
      if (!orderId || !awbNumber || !fieldId) {
        reply.status(400);
        return { message: 'Missing required fields' };
      }

      const baseLinkOrder = await BaseLinkOrders.create({
        base_link_order_id: orderId,
        awb_number: awbNumber,
        video_link_field_id: +fieldId,
      });

      if (!baseLinkOrder) {
        reply.status(400);
        return {
          isSuccess: false,
          message: SERVER_MESSAGE.BASE_LINK_ORDER_NOT_CREATED,
          displayMessage: SERVER_MESSAGE.BASE_LINK_ORDER_NOT_CREATED,
          data: null,
        };
      }

      reply.status(200);
      return {
        isSuccess: true,
        message: SERVER_MESSAGE.BASE_LINK_ORDER_CREATED,
        displayMessage: SERVER_MESSAGE.BASE_LINK_ORDER_CREATED,
        data: baseLinkOrder,
      };
    } catch (error) {
      console.error('🚀 ~ error while getting base link order info -->', error);
      reply.status(500);
      return {
        isSuccess: false,
        message: SERVER_MESSAGE.INTERNAL_SERVER,
        displayMessage: SERVER_MESSAGE.INTERNAL_SERVER,
        data: null,
      };
    }
  }
}
