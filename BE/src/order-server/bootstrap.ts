import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { fastifyOptions } from '../core/http/fastify-options';
import { expressFrameworkErrors } from '../core/http/express-compat';
import { applyCompat } from '../bootstrap';
import { OrderServerModule } from './order-server.module';

/**
 * Legacy OrderServer/server.ts app settings: Express defaults (no trust proxy, x-powered-by ON —
 * it never calls app.disable), and middleware cors() → urlencoded({extended:true}) → express.json()
 * with body-parser's DEFAULT 100kb limits (no 5mb, no securityHeaders, no static).
 */
export const orderServerExpressApp = express();

export const orderServerChain = () => [
  // expressInit: `if (app.enabled('x-powered-by')) res.setHeader('X-Powered-By', 'Express')` — first, for every response
  ((_req: any, res: any, next: any) => { res.setHeader('X-Powered-By', 'Express'); next(); }) as any,
  cors() as any,
  bodyParser.urlencoded({ extended: true }) as any,
  express.json() as any,
];

export const createOrderServerApp = async (module: any = OrderServerModule): Promise<NestFastifyApplication> => {
  const opts = { ...fastifyOptions(expressFrameworkErrors as any), trustProxy: false };
  const app = await NestFactory.create<NestFastifyApplication>(module, new FastifyAdapter(opts), {
    logger: ['error', 'warn'],
    bodyParser: false,
  });
  applyCompat(app, { chain: orderServerChain, expressApp: orderServerExpressApp });
  return app;
};
