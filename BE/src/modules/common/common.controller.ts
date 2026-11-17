import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import moment from 'moment-timezone';

/** Port of legacy routes/Common/common.routes.ts (no auth on this route in legacy). */
@Controller('api/common')
export class CommonController {
  /** legacy: controllers/Common/common.controller.ts → getDate */
  @Get('get-ist-date')
  getIstDate(@Res({ passthrough: true }) reply: FastifyReply) {
    try {
      const istDate = moment().tz('Asia/Kolkata');
      const data = { day: istDate.date(), month: istDate.month() + 1, year: istDate.year() };
      reply.status(200);
      return { data };
    } catch (error) {
      console.error(error);
      reply.status(500);
      return { message: 'Internal server error' };
    }
  }
}
