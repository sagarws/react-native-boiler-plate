import path from 'path';
import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { fastifyOptions } from '../core/http/fastify-options';
import { expressFrameworkErrors } from '../core/http/express-compat';
import { applyCompat } from '../bootstrap';
import { MasterImportServerModule } from './master-import-server.module';

/**
 * Legacy MasterImportServer.ts app: Express defaults (x-powered-by ON, no trust proxy) and
 * cors() → urlencoded({extended:true}) → express.static("public"). NOTE: no express.json() —
 * JSON bodies are not parsed by the legacy MasterImportServer (req.body stays {}). Reproduced.
 */
export const masterImportServerExpressApp = express();
masterImportServerExpressApp.set('view engine', 'ejs');

export const masterImportServerChain = () => [
  ((_req: any, res: any, next: any) => { res.setHeader('X-Powered-By', 'Express'); next(); }) as any,
  cors() as any,
  bodyParser.urlencoded({ extended: true }) as any,
  express.static(path.join('public')) as any,
];

export const createMasterImportServerApp = async (module: any = MasterImportServerModule): Promise<NestFastifyApplication> => {
  const opts = { ...fastifyOptions(expressFrameworkErrors as any), trustProxy: false };
  const app = await NestFactory.create<NestFastifyApplication>(module, new FastifyAdapter(opts), { logger: ['error', 'warn'], bodyParser: false });
  applyCompat(app, { chain: masterImportServerChain, expressApp: masterImportServerExpressApp });
  return app;
};
