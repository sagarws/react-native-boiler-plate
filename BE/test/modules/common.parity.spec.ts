import commonRouter from '@legacy/routes/Common/common.routes';
import { CommonModule } from '../../src/modules/common/common.module';
import { startPair } from '../support/legacy-app';
import { pick, send, Req } from '../support/parity';

describe('Common module parity (/api/common)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  beforeAll(async () => { p = await startPair([['/api/common', commonRouter]], CommonModule); });
  afterAll(() => p.close());

  it.each<[string, Req]>([
    ['GET get-ist-date', { method: 'GET', path: '/api/common/get-ist-date' }],
    ['GET get-ist-date trailing slash + query', { method: 'GET', path: '/api/common/get-ist-date/?x=1' }],
    ['GET get-ist-date with junk auth header (route is public)', { method: 'GET', path: '/api/common/get-ist-date', headers: { authorization: 'Bearer junk' } }],
    ['POST get-ist-date → 404 page', { method: 'POST', path: '/api/common/get-ist-date' }],
    ['HEAD get-ist-date', { method: 'HEAD', path: '/api/common/get-ist-date' }],
    ['unknown path under prefix → 404', { method: 'GET', path: '/api/common/nope' }],
  ])('%s', async (_n, r) => {
    const a = pick(await send(p.legacyPort, r));
    const b = pick(await send(p.newPort, r));
    expect(b).toEqual(a);
  });

  it('returns the IST calendar date', async () => {
    const r = await send(p.newPort, { method: 'GET', path: '/api/common/get-ist-date' });
    expect(Object.keys(JSON.parse(r.body).data)).toEqual(['day', 'month', 'year']);
  });
});
