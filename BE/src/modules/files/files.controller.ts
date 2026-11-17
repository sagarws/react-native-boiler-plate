import { Controller, Delete, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { getFile, getFileLink, getDriveLink, deleteFileFromS3, retryCloudProcessing } from '@legacy/controllers/File/file.controller';
import { Post } from '../../core/http/routes';
import { AdminAuth } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import { applyExpressWildcard } from '../../core/http/express-wildcard';

const BASE = '/api/files';
/** `router.METHOD('/<sub>/:key(*)', handler)` — Express wildcard params, then the legacy handler. */
const wild = (q: Rq, r: Reply, sub: string, handler: any) => (applyExpressWildcard(q, r, `${BASE}${sub}`) ? delegate(q, r, handler) : undefined);

/**
 * Express's `/get-file-link/:key(*)` needs the slash after the prefix: `/get-file-link` (no slash)
 * does not match it and falls through to `GET /:key(*)` (getFile, key "get-file-link").
 * Fastify treats both forms as one route (ignoreTrailingSlash), so decide on the raw path.
 */
const subRoute = (q: Rq, r: Reply, sub: string, handler: any) => {
  const pathname = (q.raw.url || '').split('?')[0];
  if (pathname.length === `${BASE}${sub}`.length) return wild(q, r, '', getFile);
  return wild(q, r, sub, handler);
};

/**
 * Port of legacy routes/Files/files.routes.ts (handlers delegated). Paths use Express `:key(*)`
 * (key may contain `/`, may be empty; `/api/files` itself matches `GET /:key(*)`).
 * Legacy: no auth on get/link/drive-link/delete — kept (see PROGRESS "Legacy PRs").
 */
@Controller('api/files')
export class FilesController {
  @Post('retry-cloud-processing') @AdminAuth(['vms::edit']) retry(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, retryCloudProcessing); }
  @Get(['get-file-link', 'get-file-link/*']) link(@Req() q: Rq, @Res() r: Reply) { return subRoute(q, r, '/get-file-link', getFileLink); }
  @Get(['get-drive-link', 'get-drive-link/*']) drive(@Req() q: Rq, @Res() r: Reply) { return subRoute(q, r, '/get-drive-link', getDriveLink); }
  @Delete(['', '*']) remove(@Req() q: Rq, @Res() r: Reply) { return wild(q, r, '', deleteFileFromS3); }
  @Get(['', '*']) file(@Req() q: Rq, @Res() r: Reply) { return wild(q, r, '', getFile); }
}
