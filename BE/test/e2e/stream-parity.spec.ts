import 'reflect-metadata';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Controller, Get, Module, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { createApp } from '../../src/bootstrap';
import { runLegacyHandler } from '../../src/core/sse';

const closed: string[] = [];
/** Shaped like legacy notification/support-chat SSE controllers. */
const sse = (tag: string) => (req: any, res: any) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'Cache-Control': 'no-cache' });
  res.write(`data: ${JSON.stringify([{ id: 1, q: req.query.x ?? null }])}\n\n`);
  const t = setInterval(() => res.write(': ping\n\n'), 20);
  req.on('close', () => { clearInterval(t); closed.push(tag); });
};
const download = (req: any, res: any) => {
  res.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
  res.type('text/csv');
  res.send('a,b\n1,2\n');
};
const redirect = (req: any, res: any) => res.redirect('https://example.com/x?y=1');
const throws = () => { throw new Error('sync boom'); };

const buildExpress = () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  app.get('/s/sse', sse('legacy'));
  app.get('/s/download', download);
  app.get('/s/redirect', redirect);
  app.get('/s/throws', throws);
  return app;
};

@Controller('s')
class StreamProbe {
  @Get('sse') a(@Req() q: FastifyRequest, @Res() r: FastifyReply) { return runLegacyHandler(q, r, sse('nest')); }
  @Get('download') b(@Req() q: FastifyRequest, @Res() r: FastifyReply) { return runLegacyHandler(q, r, download); }
  @Get('redirect') c(@Req() q: FastifyRequest, @Res() r: FastifyReply) { return runLegacyHandler(q, r, redirect); }
  @Get('throws') d(@Req() q: FastifyRequest, @Res() r: FastifyReply) { return runLegacyHandler(q, r, throws); }
}
@Module({ controllers: [StreamProbe] })
class StreamModule {}

/** Reads the raw HTTP head + first bytes of a streaming response, then aborts like a closing browser tab. */
const readStream = (port: number, path: string, bytes: number) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers: { origin: 'x' } }, (res) => {
      let body = '';
      res.on('data', (c) => {
        body += c;
        if (body.length >= bytes) { resolve({ status: res.statusCode, headers: res.headers, body: body.slice(0, bytes) }); req.destroy(); }
      });
    });
    req.on('error', (e: any) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
  });

describe('Streams / SSE / download / redirect parity vs Express', () => {
  let legacy: http.Server;
  let nest: NestFastifyApplication;
  let lp: number;
  let np: number;
  let errSpy: jest.SpyInstance;
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    legacy = http.createServer(buildExpress());
    lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createApp(StreamModule);
    await nest.listen(0, '127.0.0.1');
    np = (nest.getHttpServer().address() as any).port;
  });
  afterAll(async () => {
    errSpy.mockRestore();
    await nest.close();
    await new Promise((r) => legacy.close(r));
  });

  it('SSE: same status, headers and event framing; close handler runs', async () => {
    const want = 'data: [{"id":1,"q":"7"}]\n\n: ping\n\n: ping\n\n';
    const [a, b] = await Promise.all([readStream(lp, '/s/sse?x=7', want.length), readStream(np, '/s/sse?x=7', want.length)]);
    expect(a.body).toBe(want);
    expect(b.body).toBe(a.body);
    expect(b.status).toBe(a.status);
    const h = (x: any) => ({ ct: x.headers['content-type'], cc: x.headers['cache-control'], conn: x.headers.connection, te: x.headers['transfer-encoding'], acao: x.headers['access-control-allow-origin'], nosniff: x.headers['x-content-type-options'], rp: x.headers['referrer-policy'] });
    expect(h(b)).toEqual(h(a));
    await new Promise((r) => setTimeout(r, 100));
    expect(closed.sort()).toEqual(['legacy', 'nest']);
  });

  it.each(['/s/download', '/s/redirect', '/s/throws', '/s/redirect?x=1'])('%s', async (p) => {
    const get = (port: number) => new Promise<any>((resolve) => http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = ''; res.on('data', (c) => (body += c)); res.on('end', () => resolve({ status: res.statusCode, body, h: ['content-type', 'content-disposition', 'content-length', 'location', 'etag', 'content-security-policy', 'x-content-type-options', 'access-control-allow-origin'].map((k) => res.headers[k]) }));
    }));
    expect(await get(np)).toEqual(await get(lp));
  });
});

describe('async rejection in a legacy handler/middleware → request left open (Express 4)', () => {
  it('both servers leave the request hanging and log [UNHANDLED REJECTION]', async () => {
    const { Legacy } = require('../../src/core/auth');
    const asyncFail = async () => { throw new Error('async boom'); };
    const app = express();
    // Express 4 ignores the returned promise; legacy server.ts's process handler logs the rejection.
    // (jest would fail on a real unhandled rejection, so that process handler is reproduced inline.)
    const asExpress4 = (fn: () => Promise<unknown>) => () => { fn().catch((e) => console.error('[UNHANDLED REJECTION]', e)); };
    app.get('/h', asExpress4(asyncFail));
    app.get('/m', asExpress4(asyncFail), (req: any, res: any) => res.send('never'));
    @Controller('')
    class P {
      @Get('h') h(@Req() q: FastifyRequest, @Res() r: FastifyReply) { return runLegacyHandler(q, r, asyncFail); }
      @Get('m') @Legacy(asyncFail) m() { return 'never'; }
    }
    @Module({ controllers: [P] })
    class PM {}
    const legacySrv = http.createServer(app);
    await new Promise<void>((r) => legacySrv.listen(0, '127.0.0.1', () => r()));
    const onUnhandled = () => undefined; // legacy server.ts logs these; keep jest from failing on them
    process.on('unhandledRejection', onUnhandled);
    const nestApp = await createApp(PM);
    await nestApp.listen(0, '127.0.0.1');
    const errs: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { errs.push(String(a[0])); });
    const t = (port: number, path: string) => Promise.race([
      new Promise((res) => http.get({ host: '127.0.0.1', port, path }, (r) => res(r.statusCode)).on('error', () => res('ERR'))),
      new Promise((res) => setTimeout(() => res('TIMEOUT'), 300)),
    ]);
    for (const path of ['/h', '/m']) {
      expect(await t((legacySrv.address() as any).port, path)).toBe('TIMEOUT');
      expect(await t((nestApp.getHttpServer().address() as any).port, path)).toBe('TIMEOUT');
    }
    expect(errs.filter((e) => e === '[UNHANDLED REJECTION]').length).toBe(2);
    spy.mockRestore();
    process.off('unhandledRejection', onUnhandled);
    (nestApp.getHttpServer() as any).closeAllConnections?.();
    legacySrv.closeAllConnections();
    await nestApp.close();
    await new Promise((r) => legacySrv.close(r));
  });
});
