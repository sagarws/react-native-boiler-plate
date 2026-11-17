import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  archiveNotification, checkNotification, getAllNotification, getBackgroundJobs, markAllAsRead, markAsRead,
} from '@legacy/controllers/Notification/notification.controller';
import { AdminAuth, Auth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';

/**
 * Port of legacy routes/Notification/notification.routes.ts (handlers delegated).
 * GET /sse is a text/event-stream kept open; live pushes come from the legacy
 * notificationStream change stream, started in main.ts (see PROGRESS decisions).
 * `adminAuth([])` = any admin/user with a valid role (no permission path).
 */
@Controller('api/notifications')
export class NotificationController {
  @Get('mark-as-read/:notificationId') @AdminAuth([]) read(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, markAsRead); }
  @Get('mark-all-as-read') @AdminAuth([]) readAll(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, markAllAsRead); }
  @Get() @AdminAuth([]) list(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getAllNotification); }
  @Get('sse') @Auth() sse(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, checkNotification); }
  @Get('background-jobs') @AdminAuth([]) jobs(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getBackgroundJobs); }
  @Get('archive/:notificationId') @AdminAuth([]) archive(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, archiveNotification); }
}
