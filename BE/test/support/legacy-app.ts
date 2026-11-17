import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { createApp } from '../../src/bootstrap';

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
  const legacy = http.createServer(buildLegacyApp(mounts));
  const legacyPort = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
  const nest: NestFastifyApplication = await createApp(nestModule);
  await nest.listen(0, '127.0.0.1');
  const newPort = (nest.getHttpServer().address() as any).port as number;
  const close = async () => {
    await nest.close();
    await new Promise((r) => legacy.close(r));
  };
  return { legacyPort, newPort, close };
};
