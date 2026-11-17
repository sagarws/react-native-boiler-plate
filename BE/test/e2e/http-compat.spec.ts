import 'reflect-metadata';
import { Controller, Get, Param, Query, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { fastifyOptions } from '../../src/core/http/fastify-options';
import { createApp } from '../../src/bootstrap';

@Controller('probe')
class ProbeController {
  @Get('q') q(@Query() q: unknown) { return q; }
  @Get('user/:name') user(@Param('name') name: string) { return { name }; }
}
@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('HTTP compat (Express defaults on Fastify)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(ProbeModule, new FastifyAdapter(fastifyOptions()), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(() => app.close());

  const get = (url: string) => app.getHttpAdapter().getInstance().inject({ method: 'GET', url });

  it('parses nested and array query strings with qs (item 1)', async () => {
    const r = await get('/probe/q?a[b]=1&c[]=x&c[]=y&d=2');
    expect(r.json()).toEqual({ a: { b: '1' }, c: ['x', 'y'], d: '2' });
  });

  it('ignores trailing slash (item 6)', async () => {
    expect((await get('/probe/q/')).statusCode).toBe(200);
  });

  it('matches paths case-insensitively and keeps param case (item 6)', async () => {
    const r = await get('/PROBE/User/NodeJS');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ name: 'NodeJS' });
  });

  it('does not send x-powered-by (legacy disables it)', async () => {
    expect((await get('/probe/q')).headers['x-powered-by']).toBeUndefined();
  });
});

describe('root route', () => {
  it('GET / returns legacy "Hello World!" as text/html', async () => {
    const app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const r = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe('Hello World!');
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    await app.close();
  });
});
