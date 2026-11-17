import mongoose from 'mongoose';
import storageHistoryRouter from '@legacy/routes/StorageHistory/storageHistory.routes';
import StorageHistory from '@legacy/models/StorageHistory/StorageHistory.modal';
import Order from '@legacy/models/Order/order.model';
import Feed from '@legacy/models/Feed/feed.model';
import { FeedUser } from '@legacy/models/User/feedUser.model';
import Credit from '@legacy/models/Credits/credit.model';
import EffectiveAmountUsage from '@legacy/models/EffectiveAmountUsage/effectiveAmountUsage.model';
import Company from '@legacy/models/Company/company.model';
import File from '@legacy/models/File/file.model';
import { StorageHistoryModule } from '../../src/modules/storage-history/storage-history.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

describe('StorageHistory parity (/api/storage-history) — delegated legacy handlers', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const oid = () => new mongoose.Types.ObjectId();
  const feedId = oid();
  const fileId = oid();

  beforeAll(async () => {
    spies = (process.env.SHOW ? ['log'] : ['error', 'log']).map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    memoryDb.use(StorageHistory, Order, Feed, FeedUser, Credit, EffectiveAmountUsage, Company, File);
    const d = (s: string) => new Date(s);
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'acme@x.io', createdAt: d('2025-01-01T00:00:00Z') }]);
    memoryDb.seed(Feed, [{ _id: feedId, feedName: 'Station 1', companyId: auth.companyId }]);
    memoryDb.seed(File, [{ _id: fileId, size: 1048576, companyId: auth.companyId }]);
    memoryDb.seed(StorageHistory, [
      { companyId: auth.companyId, feedId, date: d('2026-03-01T00:00:00Z'), totalRecordCount: 4, totalRecordSize: 4096, deletedCount: 1, deletedSize: 1024, orders: [] },
      { companyId: auth.companyId, feedId, date: d('2026-03-02T00:00:00Z'), totalRecordCount: 2, totalRecordSize: 2048, deletedCount: 0, deletedSize: 0, orders: [] },
    ]);
    memoryDb.seed(Order, [
      { companyId: auth.companyId, feedId, fileId, deleteOn: d('2026-04-01T00:00:00Z'), isDeleted: true, createdAt: d('2026-03-01T10:00:00Z'), trackingId: 'T1' },
      { companyId: auth.companyId, feedId, fileId, deleteOn: d('2026-04-02T00:00:00Z'), isDeleted: false, createdAt: d('2026-03-02T10:00:00Z'), trackingId: 'T2' },
    ]);
    p = await startPair([['/api/storage-history', storageHistoryRouter]], StorageHistoryModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const post = (path: string, headers: object, body: object): Req => ({ method: 'POST', path, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['overview as sysadmin', () => post('/api/storage-history', auth.h.sys, { startDate: '2026-03-01', endDate: '2026-03-31' })],
    ['overview paging + search', () => post('/api/storage-history', auth.h.sys, { startDate: '2026-03-01', endDate: '2026-03-31', page: 1, limit: 5, search: 'acm' })],
    ['overview search no match', () => post('/api/storage-history', auth.h.sys, { startDate: '2026-03-01', search: 'zzz' })],
    ['overview invalid endDate', () => post('/api/storage-history', auth.h.sys, { startDate: '2026-03-01', endDate: 'nope', search: 'zzz' })],
    ['overview as normal user → 401', () => post('/api/storage-history', auth.h.admin, {})],
    ['overview no token', () => post('/api/storage-history', auth.h.none, {})],
    ['feed details', () => post('/api/storage-history/feed', auth.h.sys, { companyId: String(auth.companyId), startDate: '2026-03-01', endDate: '2026-03-31' })],
    ['feed details invalid companyId → 500', () => post('/api/storage-history/feed', auth.h.sys, { companyId: 'bad' })],
    ['feed details as normal user → 401', () => post('/api/storage-history/feed', auth.h.admin, {})],
    ['add-storage-history (public, rebuilds)', () => ({ method: 'GET', path: '/api/storage-history/add-storage-history' }), { creates: true }],
    ['GET / → 404 page', () => ({ method: 'GET', path: '/api/storage-history' })],
  ];

  it.each(CASES)('%s', async (_n, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('overview returns real aggregated data (not an error envelope)', async () => {
    const r = await runParity(p, post('/api/storage-history', auth.h.sys, { startDate: '2026-03-01', endDate: '2026-03-31' }));
    const body = JSON.parse(r.raw.b.body);
    expect(r.raw.b.status).toBe(200);
    expect(body.isSuccess).toBe(true);
    expect(body.data.companies.length).toBeGreaterThan(0);
  });

  it('feed details and add-storage-history reach their success paths', async () => {
    const f = await runParity(p, post('/api/storage-history/feed', auth.h.sys, { companyId: String(auth.companyId), startDate: '2026-03-01', endDate: '2026-03-31' }));
    expect(f.raw.b.status).toBe(200);
    expect(JSON.parse(f.raw.b.body).isSuccess).toBe(true);
    const a = await runParity(p, { method: 'GET', path: '/api/storage-history/add-storage-history' }, { creates: true });
    expect(a.raw.b.status).toBe(200);
    expect(JSON.parse(a.raw.b.body)).toEqual({ isSuccess: true, message: 'Storage history added successfully' });
  });
});
