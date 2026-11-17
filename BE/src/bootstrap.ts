import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { fastifyOptions } from './core/http/fastify-options';

/** Builds the app without listening or touching the DB, so tests can use it in-process. */
export const createApp = async (): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(fastifyOptions()), {
    logger: ['error', 'warn'],
    bodyParser: true,
  });
  return app;
};
