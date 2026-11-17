import { Controller, Delete, Get, Put, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  deleteMember, getUserDetails, getEcommerceCredentials, getCompanyMembers, updateAdminLogo, updateUserProfile,
  createBillingDetails, getBillingDetails, getCompanyUsers, updateSubUserProfile, getUserVideoSettings,
  getUserECommerceSettings, updateECommerceSettings, updateVideoSettings, checkPassword,
  updateAutoBookmarkVideoSettings, getAutoBookmarkVideoSettings,
} from '@legacy/controllers/User/user.controller';
import { logoUploader } from '@legacy/middleware/logoUploader.middleware';
import { Post } from '../../core/http/routes';
import { AdminAuth, Auth, Legacy, adminAuth, authMiddleware } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/**
 * Port of legacy routes/User/user.routes.ts — 17 routes, same middleware chains in the same order.
 * Handlers delegated (991-line controller). Legacy quirks kept for contract parity (PROGRESS "Legacy PRs"):
 * - GET /members and DELETE /delete pass the adminAuth FACTORY as middleware → requests hang.
 * - POST /upload-logo has no auth middleware (only the logo uploader).
 */
@Controller('api/user')
export class UserController {
  @Get('get-user') @Auth() getUser(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getUserDetails); }
  @Get('ecommerce-credentials') @AdminAuth(['integrations::view']) ecomCreds(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getEcommerceCredentials); }
  @Put('update-user/:id') @AdminAuth(['']) updateUser(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateUserProfile); }
  @Get('members') @Legacy(adminAuth as unknown as MW) members(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCompanyMembers); }
  @Delete('delete') @Legacy(adminAuth as unknown as MW) remove(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deleteMember); }
  @Post('upload-logo') @Legacy(logoUploader as MW) uploadLogo(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateAdminLogo); }
  @Post('create-billing') @Legacy(adminAuth(['accounts::plan::edit']) as MW, authMiddleware as MW) createBilling(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, createBillingDetails); }
  @Get('get-billing') @Legacy(adminAuth(['accounts::plan::view']) as MW, authMiddleware as MW) getBilling(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getBillingDetails); }
  @Post('update-video-settings') @AdminAuth(['settings::edit']) updVideo(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateVideoSettings); }
  @Post('update-ecommerce-settings') @AdminAuth(['settings::edit']) updEcom(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateECommerceSettings); }
  @Get('video-settings') @AdminAuth(['settings::view']) videoSettings(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getUserVideoSettings); }
  @Get('ecommerce-settings') @AdminAuth(['settings::view']) ecomSettings(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getUserECommerceSettings); }
  @Get('get-company-users') @AdminAuth(['manage_users::view']) companyUsers(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCompanyUsers); }
  @Put('update-sub-user/:id') @AdminAuth(['profile::edit']) updSubUser(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateSubUserProfile); }
  @Post('check-password') @Auth() checkPw(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, checkPassword); }
  @Post('update-auto-bookmark-video-settings') @AdminAuth(['settings::edit']) updBookmark(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, updateAutoBookmarkVideoSettings); }
  @Get('get-auto-bookmark-video-settings') @AdminAuth(['settings::view']) getBookmark(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getAutoBookmarkVideoSettings); }
}
