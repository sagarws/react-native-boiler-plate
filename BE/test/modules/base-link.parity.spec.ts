import baseLinkRouter from '@legacy/routes/BaseLink/base-link.routes';
import BaseLinkOrders from '@legacy/models/BaseLinkOrders/baseLinkOrders.model';
import { BaseLinkModule } from '../../src/modules/base-link/base-link.module';
import { startPair } from '../support/legacy-app';
import { fakeSave, maskVolatile } from '../support/fake-models';
import { pick, send, Req } from '../support/parity';

describe('BaseLink module parity (/api/base-link)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let save: ReturnType<typeof fakeSave>;
  let errSpy: jest.SpyInstance;
  beforeAll(async () => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    save = fakeSave(BaseLinkOrders);
    p = await startPair([['/api/base-link', baseLinkRouter]], BaseLinkModule);
  });
  afterAll(async () => { save.restore(); errSpy.mockRestore(); await p.close(); });

  it.each<[string, Req]>([
    ['creates order link', { method: 'GET', path: '/api/base-link/ORD-1/AWB123/7' }],
    ['encoded params', { method: 'GET', path: '/api/base-link/ORD%201/AWB%2F9/12' }],
    ['non-numeric fieldId → cast error → 500', { method: 'GET', path: '/api/base-link/ORD-1/AWB123/abc' }],
    ['fieldId 0', { method: 'GET', path: '/api/base-link/O/A/0' }],
    ['missing segment → 404 page', { method: 'GET', path: '/api/base-link/ORD-1/AWB123' }],
    ['extra segment → 404 page', { method: 'GET', path: '/api/base-link/a/b/1/x' }],
    ['POST → 404 page', { method: 'POST', path: '/api/base-link/a/b/1' }],
  ])('%s', async (_n, r) => {
    const a = pick(await send(p.legacyPort, r));
    const b = pick(await send(p.newPort, r));
    for (const x of [a, b]) { x.body = maskVolatile(x.body); if (x.status === 200) { delete x.headers.etag; } }
    expect(b).toEqual(a);
  });

  it('writes the same document fields on both sides', () => {
    const strip = ({ _id, ...rest }: any) => rest;
    const docs = save.saved.map(strip);
    const half = docs.length / 2;
    expect(docs.length % 2).toBe(0);
    // requests ran legacy-then-new per case, so saved docs alternate
    for (let i = 0; i < half; i++) expect(docs[2 * i + 1]).toEqual(docs[2 * i]);
  });
});
