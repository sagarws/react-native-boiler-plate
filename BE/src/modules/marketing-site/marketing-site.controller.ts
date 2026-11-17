import { Controller, Get, Req, Res } from '@nestjs/common';
import type { FastifyReply as Reply, FastifyRequest as Rq } from 'fastify';
import { getCreditSettingsForMarketingSite, getPlansForMarketingSite, bookDemo, downloadLatestRelease } from '@legacy/controllers/MarketingSite/marketingSite.controller';
import { rateLimiter } from '@legacy/middleware/rateLimit.middleware';
import { Post } from '../../core/http/routes';
import { Legacy } from '../../core/auth';
import { delegate } from '../../core/legacy/delegate';
import type { LegacyMiddleware as MW } from '../../core/legacy/express-adapter';

/** One limiter instance per route, created at load like legacy (6 req/min per IP, public routes). */
const perMinute6 = () => rateLimiter({ windowMs: 60 * 1000, max: 6 }) as unknown as MW;

/** Port of legacy routes/MarketingSite/marketingSite.routes.ts (public; handlers delegated). */
@Controller('api/marketing-site')
export class MarketingSiteController {
  @Get('plans') @Legacy(perMinute6()) plans(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getPlansForMarketingSite); }
  @Get('get-credit-settings') @Legacy(perMinute6()) credit(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, getCreditSettingsForMarketingSite); }
  @Post('book-demo') @Legacy(perMinute6()) demo(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, bookDemo); }
  @Get('release') @Legacy(perMinute6()) release(@Req() q: Rq, @Res() r: Reply) { return delegate(q, r, downloadLatestRelease); }
}
