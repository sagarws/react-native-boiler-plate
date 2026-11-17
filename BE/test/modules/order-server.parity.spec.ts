import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import orderServerRouter from '@legacy/OrderServer/routes/file.route';
import Company from '@legacy/models/Company/company.model';
import { S3Service } from '@legacy/utils/s3';
import { createOrderServerApp } from '../../src/order-server/bootstrap';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { routesOf, smokeCases, runParity } from '../support/route-smoke';
import { pick, send } from '../support/parity';

/** Legacy OrderServer/server.ts app, minus bull-board and the worker imports. */
const buildLegacyOrderServer = () => {
  const app = express();
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/order', orderServerRouter);
  return app;
};

describe('OrderServer parity (/order on the file/order upload process)', () => {
  let ports: { legacyPort: number; newPort: number };
  let legacy: http.Server;
  let nest: any;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const at = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    for (const m of ['uploadObject', 'uploadBuffer', 'deleteObject', 'getObject']) spies.push(jest.spyOn(S3Service.prototype as any, m).mockImplementation((async () => ({ Body: Buffer.from('x'), ContentType: 'video/mp4' })) as any));
    // deterministic S3 object for GET /order/view/:key(*) (streams the body)
    spies.push(jest.spyOn(S3Service.prototype as any, 'headObject').mockImplementation((async () => ({ ContentLength: 8, ETag: '"abc123"' })) as any));
    spies.push(jest.spyOn(S3Service.prototype as any, 'getObjectStream').mockImplementation((() => require('stream').Readable.from([Buffer.from('MP4DATA!')])) as any));
    auth = seedAuth();
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    legacy = http.createServer(buildLegacyOrderServer());
    const lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createOrderServerApp();
    await nest.listen(0, '127.0.0.1');
    ports = { legacyPort: lp, newPort: nest.getHttpServer().address().port };
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => {
    spies.forEach((s) => s.mockRestore());
    nest.getHttpServer().closeAllConnections?.(); legacy.closeAllConnections();
    await nest.close(); await new Promise((r) => legacy.close(r)); memoryDb.uninstall();
  });

  const tok = { get authorization() { return `Bearer ${auth.tokens.admin}`; } } as any;
  // route list from the legacy route file (this controller is hand-written)
  const ROUTES = [
    { method: 'POST', path: '/order/create-order' }, { method: 'POST', path: '/order/get-upload-url' },
    { method: 'POST', path: '/order/create-order-v2' }, { method: 'GET', path: '/order/view/videos/a.mp4' },
    { method: 'DELETE', path: '/order/delete' }, { method: 'POST', path: '/order/cloud-processed' },
    { method: 'POST', path: '/order/get-feed-settings' },
  ];
  const CASES = smokeCases(ROUTES, { anon: {}, admin: tok });

  it.each(CASES)('%s', async (_n, mk, opts) => {
    const req = mk();
    if (req.headers.authorization) req.headers = { ...req.headers, authorization: String(req.headers.authorization) };
    const r = await runParity(ports, req, opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it.each([
    ['GET', '/order/view'], ['GET', '/order/view/'], ['GET', '/order/view/a%2Fb.mp4'], ['GET', '/order/view/a%ZZ'],
    ['GET', '/order/nope'], ['OPTIONS', '/order/create-order'],
  ])('edge %s %s', async (method, path) => {
    const r = await runParity(ports, { method, path, headers: { origin: 'x', 'access-control-request-method': 'POST' } }, { bodyMasks: [/<pre>[\s\S]*?<\/pre>/] });
    expect(r.next).toEqual(r.legacy);
  });

  it('view streams the S3 object with legacy headers on both', async () => {
    const r = await runParity(ports, { method: 'GET', path: '/order/view/videos/a.mp4' });
    expect(r.next).toEqual(r.legacy);
    expect([r.raw.b.status, r.raw.b.body]).toEqual([200, 'MP4DATA!']);
  });

  it('OrderServer body limit is body-parser default (100kb), not 5mb', async () => {
    const big = JSON.stringify({ a: 'x'.repeat(150 * 1024) });
    const req = { method: 'POST', path: '/order/get-feed-settings', headers: { 'content-type': 'application/json' }, body: big };
    const a = pick(await send(ports.legacyPort, req));
    const b = pick(await send(ports.newPort, req));
    expect(a.status).toBe(413);
    expect(b.status).toBe(a.status);
    expect(b.headers['x-powered-by']).toBe(a.headers['x-powered-by']);
  });
});
