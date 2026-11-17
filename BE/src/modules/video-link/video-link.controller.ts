import { Controller, Get, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import rateLimit from 'express-rate-limit';
import { SERVER_MESSAGE, SERVER_STATUS_CODE } from '@legacy/enum/response.enum';
import { findCompanyOrderVideos } from '@legacy/services/order-video.service';
import { adminAuth, Legacy } from '../../core/auth';
import { LegacyReq } from '../../core/legacy/legacy-req.decorator';
import type { LegacyMiddleware } from '../../core/legacy/express-adapter';

const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 50;

/**
 * Same options as the limiter declared inside legacy routes/VideoLink/videoLink.routes.ts
 * (not exported there). Per-user key; runs after adminAuth.
 */
const videoLinkRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => String(req.user?.id),
  message: {
    isSuccess: false,
    message: 'Too many requests. Please retry in a minute.',
    displayMessage: 'Too many requests. Please retry in a minute.',
  },
});

/** Port of legacy routes/VideoLink/videoLink.routes.ts (search via legacy order-video service). */
@Controller('api/video-link')
export class VideoLinkController {
  @Get('search')
  @Legacy(adminAuth(['video_link::view']) as LegacyMiddleware, videoLinkRateLimiter as unknown as LegacyMiddleware)
  async searchVideoLinks(@LegacyReq() req: any, @Res({ passthrough: true }) reply: FastifyReply) {
    const q = String(req.query.q || '').trim();
    if (!q) {
      reply.status(SERVER_STATUS_CODE.BAD_REQUEST);
      return { isSuccess: false, message: 'Please enter an AWB or order number.', displayMessage: 'Please enter an AWB or order number.' };
    }
    if (q.length > MAX_QUERY_LENGTH) {
      reply.status(SERVER_STATUS_CODE.BAD_REQUEST);
      return { isSuccess: false, message: 'AWB or order number is too long.', displayMessage: 'AWB or order number is too long.' };
    }
    try {
      const data = await findCompanyOrderVideos({ companyId: req.user.companyId, awbNumber: q, orderNo: q, limit: MAX_RESULTS });
      reply.status(SERVER_STATUS_CODE.SUCCESS);
      return {
        isSuccess: true,
        message: data.length ? 'Video found.' : 'No video found',
        displayMessage: data.length ? 'Video found.' : 'No video found',
        data,
      };
    } catch (error) {
      console.error(`Error searching video link for company ${req.user?.companyId} / "${q}":`, error);
      reply.status(SERVER_STATUS_CODE.INTERNAL_SERVER);
      return { isSuccess: false, message: SERVER_MESSAGE.INTERNAL_SERVER, displayMessage: SERVER_MESSAGE.INTERNAL_SERVER };
    }
  }
}
