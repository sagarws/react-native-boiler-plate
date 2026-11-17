import 'reflect-metadata';
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Controller, Get, Module, Req } from '@nestjs/common';
import { Post } from '../../src/core/http/routes';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { createApp } from '../../src/bootstrap';
import { listen, pick, send, Req as R } from '../support/parity';

/**
 * Parity: an Express app with legacy server.ts's exact middleware stack vs the Nest app.
 * Same probe routes on both; every case must produce identical status, body and headers.
 */
const buildExpress = () => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.json({ limit: '5mb' }));
  app.get('/probe/echo', (req, res) => { res.json({ query: req.query, body: req.body }); });
  app.post('/probe/echo', (req, res) => { res.json({ query: req.query, body: req.body }); });
  app.get('/probe/text', (req, res) => { res.send('Hello World!'); });
  app.get('/probe/throw', () => { throw new Error('boom'); });
  app.post('/probe/status', (req, res) => { res.status(422).json({ isSuccess: false, message: 'bad' }); });
  return app;
};

@Controller('probe')
class ProbeController {
  @Get('echo') getEcho(@Req() req: any) { return { query: req.query, body: req.body }; }
  @Post('echo') postEcho(@Req() req: any) { return { query: req.query, body: req.body }; }
  @Get('text') text(@Req() req: any) { return 'Hello World!'; }
  @Get('throw') throwIt() { throw new Error('boom'); }
}
// res.send(string) in Express → text/html; ported handlers set it explicitly.
import { Header, HttpCode, Res } from '@nestjs/common';
Header('Content-Type', 'text/html; charset=utf-8')(ProbeController.prototype, 'text', Object.getOwnPropertyDescriptor(ProbeController.prototype, 'text'));
@Controller('probe')
class ProbeStatusController {
  @Post('status') status(@Res({ passthrough: true }) reply: any) { reply.status(422); return { isSuccess: false, message: 'bad' }; }
}
@Module({ controllers: [ProbeController, ProbeStatusController] })
class ProbeModule {}

const big = JSON.stringify({ a: 'x'.repeat(5 * 1024 * 1024 + 10) });
const json = { 'content-type': 'application/json' };
const CASES: [string, R][] = [
  ['nested qs query', { method: 'GET', path: '/probe/echo?a[b]=1&c[]=x&c[]=y&d=2' }],
  ['trailing slash', { method: 'GET', path: '/probe/echo/' }],
  ['uppercase path', { method: 'GET', path: '/PROBE/Echo' }],
  ['GET without body → body {}', { method: 'GET', path: '/probe/echo' }],
  ['json body', { method: 'POST', path: '/probe/echo', headers: json, body: '{"a":1,"b":{"c":[1,2]}}' }],
  ['json with charset', { method: 'POST', path: '/probe/echo', headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"a":1}' }],
  ['json __proto__ key', { method: 'POST', path: '/probe/echo', headers: json, body: '{"__proto__":{"x":1},"a":1}' }],
  ['json empty body', { method: 'POST', path: '/probe/echo', headers: { ...json, 'content-length': '0' }, body: '' }],
  ['json malformed', { method: 'POST', path: '/probe/echo', headers: json, body: '{"a":' }],
  ['json strict violation', { method: 'POST', path: '/probe/echo', headers: json, body: '"abc"' }],
  ['json too large', { method: 'POST', path: '/probe/echo', headers: json, body: big }],
  ['urlencoded extended', { method: 'POST', path: '/probe/echo', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a[b]=1&c[]=x&c[]=y&d=2' }],
  ['text/plain body ignored', { method: 'POST', path: '/probe/echo', headers: { 'content-type': 'text/plain' }, body: 'hello' }],
  ['no content-type body ignored', { method: 'POST', path: '/probe/echo', headers: { 'content-length': '5' }, body: 'hello' }],
  ['unknown content-type', { method: 'POST', path: '/probe/echo', headers: { 'content-type': 'application/xml' }, body: '<a/>' }],
  ['cors preflight', { method: 'OPTIONS', path: '/probe/echo', headers: { origin: 'https://app.trackvid.in', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } }],
  ['cors simple', { method: 'GET', path: '/probe/echo', headers: { origin: 'https://app.trackvid.in' } }],
  ['preflight on unknown route', { method: 'OPTIONS', path: '/nope', headers: { origin: 'x', 'access-control-request-method': 'GET' } }],
  ['404 unknown route', { method: 'GET', path: '/nope/deeper?x=1' }],
  ['404 POST unknown route', { method: 'POST', path: '/nope', headers: json, body: '{"a":1}' }],
  ['text response', { method: 'GET', path: '/probe/text' }],
  ['HEAD', { method: 'HEAD', path: '/probe/echo' }],
  ['etag freshness 304', { method: 'GET', path: '/probe/text', headers: { 'if-none-match': 'W/"c-Lve95gjOVATpfV8EL5X4nxwjKHE"' } }],
  ['sync throw → 500', { method: 'GET', path: '/probe/throw' }],
  ['per-branch status', { method: 'POST', path: '/probe/status', headers: json, body: '{}' }],
];

describe.each(['production', 'development'])('Express parity (NODE_ENV=%s)', (env) => {
  let legacy: http.Server;
  let nest: NestFastifyApplication;
  let lp: number;
  let np: number;
  const prevEnv = process.env.NODE_ENV;
  let errSpy: jest.SpyInstance;

  beforeAll(async () => {
    process.env.NODE_ENV = env;
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    legacy = http.createServer(buildExpress());
    lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createApp(ProbeModule);
    await nest.listen(0, '127.0.0.1');
    np = (nest.getHttpServer().address() as any).port;
  });
  afterAll(async () => {
    process.env.NODE_ENV = prevEnv;
    errSpy.mockRestore();
    await nest.close();
    await new Promise((r) => legacy.close(r));
  });

  it.each(CASES)('%s', async (_name, r) => {
    const [a, b] = await Promise.all([send(lp, r), send(np, r)]);
    const pa = pick(a);
    const pb = pick(b);
    if (env === 'development' && a.status >= 400 && /<pre>/.test(a.body)) {
      // dev error pages print the stack trace (different file paths); compare only the first line
      const first = (s: string) => (s.match(/<pre>([^<\n]*)/) || [])[1];
      expect(first(pb.body)).toEqual(first(pa.body));
      delete pa.headers['content-length']; delete pb.headers['content-length'];
      pa.body = pb.body = '';
    }
    expect(pb).toEqual(pa);
  });
});
