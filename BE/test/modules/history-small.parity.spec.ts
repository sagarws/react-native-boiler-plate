import mongoose from 'mongoose';
import claimHistoryRouter from '@legacy/routes/ClaimHistory/claimHistory.route';
import creditHistoryRouter from '@legacy/routes/CreditHistory/creditHistory.routes';
import ClaimHistory from '@legacy/models/ClaimHistory/claimHistory.model';
import CreditHistory from '@legacy/models/CreditHistory/CreditHistory.modal';
import Feed from '@legacy/models/Feed/feed.model';
import { Module } from '@nestjs/common';
import { ClaimHistoryModule } from '../../src/modules/claim-history/claim-history.module';
import { CreditHistoryModule } from '../../src/modules/credit-history/credit-history.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity } from '../support/module-parity';
import { Req } from '../support/parity';

@Module({ imports: [ClaimHistoryModule, CreditHistoryModule] })
class M {}

describe('ClaimHistory + CreditHistory parity', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let errSpy: jest.SpyInstance;
  const oid = () => new mongoose.Types.ObjectId();
  const claimId = oid();
  const feedId = oid();
  const orderMulti = oid();
  const orderSingle = oid();
  const cmsId = oid();

  beforeAll(async () => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    auth = seedAuth();
    auth.grant('cms::view');
    memoryDb.use(ClaimHistory, CreditHistory, Feed);
    memoryDb.seed(Feed, [{ _id: feedId, feedName: 'Station 1', companyId: auth.companyId }]);
    memoryDb.seed(ClaimHistory, [{
      _id: claimId, cmsId: oid(),
      history: [
        { _id: oid(), action: 1, user: auth.userAdmin._id, feed: feedId, date: new Date('2026-02-01T10:00:00Z') },
        { _id: oid(), action: 2, user: oid(), feed: oid(), date: new Date('2026-02-02T10:00:00Z') },
      ],
    }]);
    memoryDb.seedRaw('companies', [{ _id: auth.companyId, name: 'Acme' }]);
    memoryDb.seedRaw('feeds', [{ _id: feedId, feedName: 'Station 1' }]);
    memoryDb.seedRaw('orders', [
      { _id: orderMulti, orderType: 'Return', trackingId: 'TRK-MULTI', mergedFrom: [oid()] },
      { _id: orderSingle, orderType: 'Forward', trackingId: 'TRK-ONE' },
    ]);
    memoryDb.seedRaw('cms', [{ _id: cmsId, AWBNumber: 'AWB777' }]);
    const d = (s: string) => new Date(s);
    memoryDb.seed(CreditHistory, [
      { companyId: auth.companyId, feedId, orderId: orderSingle, actionType: 1, credit: -1, createdAt: d('2026-03-01T05:00:00Z'), updatedAt: d('2026-03-01T05:00:00Z') },
      { companyId: auth.companyId, feedId, orderId: orderMulti, actionType: 1, credit: -2, createdAt: d('2026-03-01T06:00:00Z'), updatedAt: d('2026-03-01T06:00:00Z') },
      { companyId: auth.companyId, cmsId, actionType: 3, credit: -5, createdAt: d('2026-03-02T06:00:00Z'), updatedAt: d('2026-03-02T06:00:00Z') },
      { companyId: auth.companyId, actionType: 2, credit: 100, createdAt: d('2026-02-15T06:00:00Z'), updatedAt: d('2026-02-15T06:00:00Z') },
      { companyId: oid(), actionType: 1, credit: -1, createdAt: d('2026-03-01T05:00:00Z'), updatedAt: d('2026-03-01T05:00:00Z') },
    ]);
    p = await startPair([['/api/claim-history', claimHistoryRouter], ['/api/credit-history', creditHistoryRouter]], M);
  });
  afterAll(async () => { errSpy.mockRestore(); await p.close(); memoryDb.uninstall(); });

  const g = (path: string, h: object = auth.h.admin): Req => ({ method: 'GET', path, headers: h as any });
  const CASES: [string, () => Req][] = [
    ['claim-history found + populated', () => g(`/api/claim-history/${claimId}`)],
    ['claim-history unknown', () => g(`/api/claim-history/${oid()}`)],
    ['claim-history invalid id → 200 data null', () => g('/api/claim-history/xyz')],
    ['claim-history custom role with cms::view', () => g(`/api/claim-history/${claimId}`, auth.h.noPerm)],
    ['claim-history no token', () => g(`/api/claim-history/${claimId}`, {})],
    ['credit-history date range', () => g('/api/credit-history?startDate=2026-03-01&endDate=2026-03-02')],
    ['credit-history single day', () => g('/api/credit-history?startDate=2026-03-01')],
    ['credit-history paging', () => g('/api/credit-history?startDate=2026-02-01&endDate=2026-03-31&page=2&limit=2')],
    ['credit-history actionType filter', () => g('/api/credit-history?startDate=2026-02-01&endDate=2026-03-31&actionType=1,3,x')],
    ['credit-history actionType "undefined"', () => g('/api/credit-history?startDate=2026-02-01&endDate=2026-03-31&actionType=undefined')],
    ['credit-history search (ignores dates)', () => g('/api/credit-history?search=trk-multi')],
    ['credit-history search cms awb', () => g('/api/credit-history?search=AWB7')],
    ['credit-history no dates → invalid date → 500', () => g('/api/credit-history')],
    ['credit-history empty range', () => g('/api/credit-history?startDate=2020-01-01')],
    ['credit-history no token', () => g('/api/credit-history?startDate=2026-03-01', {})],
  ];

  it.each(CASES)('%s', async (_n, mk) => {
    const r = await runParity(p, mk());
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
  });

  it('credit-history really aggregates (multi-station label, totals)', async () => {
    const r = await runParity(p, g('/api/credit-history?startDate=2026-03-01&endDate=2026-03-02'));
    const body = JSON.parse(r.raw.b.body);
    expect(body.data.history).toHaveLength(3);
    expect(body.data.history.find((h: any) => h.orderData?.trackingId === 'TRK-MULTI').feedData).toEqual({ feedName: 'Multi Station' });
    expect(body.data.metadata).toEqual({ total: 3, totalPage: 1, page: 1, limit: 10 });
    const empty = JSON.parse((await runParity(p, g('/api/credit-history?startDate=2020-01-01'))).raw.b.body);
    expect(empty.data).toEqual({ metadata: {}, history: [] });
  });

  it('claim-history really populates user/feed', async () => {
    const r = await runParity(p, g(`/api/claim-history/${claimId}`));
    const h = JSON.parse(r.raw.b.body).data.history;
    expect(h[0].feed).toMatchObject({ feedName: 'Station 1' });
    expect(h[0].user).toMatchObject({ email: 'admin@x.io' });
  });
});
