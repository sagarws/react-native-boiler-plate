import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { createApp } from '../../src/bootstrap';

/**
 * Test-harness only: Express 4 ignores the promise a handler returns, so a rejected async handler
 * becomes a process-level unhandled rejection (legacy server.ts logs it; the request stays open).
 * Jest fails a test on any unhandled rejection, so attach the same logging here. Express's
 * behaviour (no response) is unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer');
if (!Layer.prototype.__legacyRejectionPatch) {
  Layer.prototype.__legacyRejectionPatch = true;
  Layer.prototype.handle_request = function handle(req: any, res: any, next: any) {
    const fn = this.handle;
    if (fn.length > 3) return next();
    try {
      const ret = fn(req, res, next);
      if (ret && typeof ret.catch === 'function') ret.catch((e: unknown) => console.error('[UNHANDLED REJECTION]', e));
    } catch (err) {
      next(err);
    }
  };
}

/** Express app with legacy server.ts's middleware stack and the given legacy routers mounted. */
export const buildLegacyApp = (mounts: [string, express.Router | express.RequestHandler][]) => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.json({ limit: '5mb' }));
  for (const [prefix, router] of mounts) app.use(prefix, router);
  return app;
};

/** Starts legacy (Express, given routers) and new (Nest, given module) on random ports. */
export const startPair = async (mounts: Parameters<typeof buildLegacyApp>[0], nestModule: any) => {
  // legacy server.ts logs unhandled rejections instead of crashing; Express 4 leaves such requests
  // open. Same here, so "both sides hang" cases don't trip jest's own rejection handling.
  const onRejection = (reason: unknown) => console.error('[UNHANDLED REJECTION]', reason);
  process.on('unhandledRejection', onRejection);
  const legacy = http.createServer(buildLegacyApp(mounts));
  const legacyPort = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
  const nest: NestFastifyApplication = await createApp(nestModule);
  await nest.listen(0, '127.0.0.1');
  const newPort = (nest.getHttpServer().address() as any).port as number;
  const close = async () => {
    // tests may leave hung requests open on purpose (legacy routes that never respond)
    (nest.getHttpServer() as http.Server).closeAllConnections?.();
    legacy.closeAllConnections?.();
    await nest.close();
    await new Promise((r) => legacy.close(r));
    process.off('unhandledRejection', onRejection);
  };
  return { legacyPort, newPort, close };
};
