import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { fastifyOptions } from './core/http/fastify-options';
import { ExpressCompatOptions, expressFrameworkErrors, registerExpressCompat } from './core/http/express-compat';
import { LegacyExceptionFilter } from './core/errors/legacy-exception.filter';

/** Applies the legacy-compat layer to any Nest app (used by the real app and by tests). */
export const applyCompat = (app: NestFastifyApplication, opts?: ExpressCompatOptions): NestFastifyApplication => {
  registerExpressCompat(app.getHttpAdapter().getInstance(), opts);
  app.useGlobalFilters(new LegacyExceptionFilter());
  return app;
};

/** Builds the app without listening or touching the DB, so tests can use it in-process. */
export const createApp = async (module: any = AppModule): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(module, new FastifyAdapter(fastifyOptions(expressFrameworkErrors as any)), {
    logger: ['error', 'warn'],
    bodyParser: false, // body-parser (same as legacy) runs in registerExpressCompat
  });
  return applyCompat(app);
};
