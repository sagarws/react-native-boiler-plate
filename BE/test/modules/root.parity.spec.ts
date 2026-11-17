import { Module } from '@nestjs/common';
import { RootController } from '../../src/root.controller';
import { startPair } from '../support/legacy-app';
import { pick, send, Req } from '../support/parity';

// legacy server.ts: app.get("/", (req, res) => { res.send("Hello World!"); });  (inline, not importable)
const legacyRoot = (req: any, res: any, next: any) => (req.method === 'GET' || req.method === 'HEAD') && req.path === '/' ? res.send('Hello World!') : next();
@Module({ controllers: [RootController] })
class RootOnly {}

describe('Root parity (GET /)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  beforeAll(async () => { p = await startPair([['/', legacyRoot]], RootOnly); });
  afterAll(() => p.close());
  it.each<[string, Req]>([
    ['GET /', { method: 'GET', path: '/' }],
    ['GET /?a=1', { method: 'GET', path: '/?a=1' }],
    ['HEAD /', { method: 'HEAD', path: '/' }],
    ['GET / with matching etag → 304', { method: 'GET', path: '/', headers: { 'if-none-match': 'W/"c-Lve95gjOVATpfV8EL5X4nxwjKHE"' } }],
    ['POST / → 404 page', { method: 'POST', path: '/' }],
  ])('%s', async (_n, r) => {
    expect(pick(await send(p.newPort, r))).toEqual(pick(await send(p.legacyPort, r)));
  });
});
