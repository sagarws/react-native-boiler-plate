import { Controller, Delete, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  addUpdateFeed, changeAllowCameraDateChangeKey, deleteFeed, disableFeed, enableFeed,
  getCameraDateChangePermission, getCommonFeed, getFeeds, getFeedUsers,
} from '@legacy/controllers/Feed/feed.controller';
import { Post } from '../../core/http/routes';
import { AdminAuth, Auth, SystemAdmin } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';

/**
 * Port of legacy routes/Feed/feed.routes.ts — 9 routes, same auth tiers. Handlers delegated
 * (573-line controller). Legacy scoping issues kept for contract parity, listed in PROGRESS
 * "Legacy PRs wanted": add-update trusts body.companyId; delete/disable/enable not company-scoped.
 */
@Controller('api/feed')
export class FeedController {
  @Post('add-update') @AdminAuth(['feed::edit']) addUpdate(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, addUpdateFeed); }
  @Post() @AdminAuth(['feed::view']) list(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getFeeds); }
  @Delete('delete') @AdminAuth(['feed::edit']) remove(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deleteFeed); }
  @Post('disable') @AdminAuth(['feed::edit']) disable(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, disableFeed); }
  @Post('enable') @AdminAuth(['feed::edit']) enable(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, enableFeed); }
  @Get('feed-user/:id') @Auth() feedUsers(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getFeedUsers); }
  @Get('common-feed') @Auth() commonFeed(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCommonFeed); }
  @Post('change-camera-date-change-permission') @SystemAdmin() changeCamPerm(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, changeAllowCameraDateChangeKey); }
  @Get('camera-date-change-permission/:id') @Auth() camPerm(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCameraDateChangePermission); }
}
