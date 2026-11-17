import { Controller, Delete, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import {
  buildDefaultTemplateHandler, buildProviderDefaultTemplateHandler, deactivateTemplateHandler, deleteTemplateHandler,
  listTemplatesHandler, previewTemplateHandler, setDefaultTemplateHandler, upsertTemplateHandler,
} from '@legacy/controllers/Template/template.controller';
import { Post } from '../../core/http/routes';
import { AdminAuth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';

const EMAIL_VIEW = ['email::view'];

/** Port of legacy routes/Template/template.routes.ts (handlers delegated; logic in services/template*). */
@Controller('api/templates')
export class TemplateController {
  @Get() @AdminAuth(EMAIL_VIEW) list(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, listTemplatesHandler); }
  @Post() @AdminAuth(EMAIL_VIEW) upsert(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, upsertTemplateHandler); }
  @Post(':templateId/deactivate') @AdminAuth(EMAIL_VIEW) deactivate(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deactivateTemplateHandler); }
  @Delete(':templateId') @AdminAuth(EMAIL_VIEW) remove(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, deleteTemplateHandler); }
  @Get('default') @AdminAuth(EMAIL_VIEW) buildDefault(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, buildDefaultTemplateHandler); }
  @Post(':templateId/default') @AdminAuth(EMAIL_VIEW) setDefault(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, setDefaultTemplateHandler); }
  @Get(':templateId/preview') @AdminAuth(EMAIL_VIEW) preview(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, previewTemplateHandler); }
  @Post('build-default') @AdminAuth(EMAIL_VIEW) buildProviderDefault(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, buildProviderDefaultTemplateHandler); }
}
