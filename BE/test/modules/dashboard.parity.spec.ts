import mongoose from 'mongoose';
import dashboardRouter from '@legacy/routes/Dashboard/dashboard.routes';
import Order from '@legacy/models/Order/order.model';
import Feed from '@legacy/models/Feed/feed.model';
import Company from '@legacy/models/Company/company.model';
import Credit from '@legacy/models/Credits/credit.model';
import { DashboardModule } from '../../src/modules/dashboard/dashboard.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity } from '../support/module-parity';
import { Req } from '../support/parity';

describe('Dashboard parity (/api/dashboard) — delegated legacy handlers', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};

  beforeAll(async () => {
    spies = ['error', 'log', 'warn'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    memoryDb.useAll();
    const at = (s: string) => new Date(s);
    const feedId = new mongoose.Types.ObjectId();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', createdAt: at('2025-06-01T00:00:00Z') }]);
    memoryDb.seed(Feed, [{ _id: feedId, feedName: 'S1', companyId: auth.companyId }]);
    memoryDb.seed(Credit, [{ companyId: auth.companyId, totalCredit: 10, remainingCredit: 5, usedCredit: 5 }]);
    memoryDb.seed(Order, [
      { companyId: auth.companyId, feedId, trackingId: 'A1', orderType: 'Forward', isDeleted: false, createdAt: at('2026-03-01T10:00:00Z') },
      { companyId: auth.companyId, feedId, trackingId: 'A2', orderType: 'Return', isDeleted: false, createdAt: at('2026-03-02T10:00:00Z') },
    ]);
    p = await startPair([['/api/dashboard', dashboardRouter]], DashboardModule);
  });
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const range = 'from=2026-03-01&to=2026-03-31&startDate=2026-03-01&endDate=2026-03-31';
  const g = (path: string, h: object): Req => ({ method: 'GET', path, headers: h as any });
  const post = (path: string, h: object, body: object): Req => ({ method: 'POST', path, headers: { ...h, 'content-type': 'application/json' } as any, body: JSON.stringify(body) });
  const CASES: [string, () => Req][] = [
    ['GET / (user)', () => g(`/api/dashboard?${range}`, auth.h.admin)],
    ['GET / no dates', () => g('/api/dashboard', auth.h.admin)],
    ['GET cms-data', () => g(`/api/dashboard/cms-data?${range}`, auth.h.admin)],
    ['GET cms-platform-summary', () => g(`/api/dashboard/cms-platform-summary?${range}`, auth.h.admin)],
    ['GET video-recordings-by-platform', () => g(`/api/dashboard/video-recordings-by-platform?${range}`, auth.h.admin)],
    ['GET getCmsStatusCount', () => g(`/api/dashboard/getCmsStatusCount?${range}`, auth.h.admin)],
    ['GET getOrderStatusCount', () => g(`/api/dashboard/getOrderStatusCount?${range}`, auth.h.admin)],
    ['GET masterImportCarrierReport', () => g(`/api/dashboard/masterImportCarrierReport?${range}`, auth.h.admin)],
    ['GET system-admin', () => g(`/api/dashboard/system-admin?${range}`, auth.h.sys)],
    ['GET getSystemAdminDashboardCmsVms', () => g(`/api/dashboard/getSystemAdminDashboardCmsVms?${range}`, auth.h.sys)],
    ['POST system-admin/insights', () => post('/api/dashboard/system-admin/insights', auth.h.sys, { startDate: '2026-03-01', endDate: '2026-03-31' })],
    ['POST system-admin/customer-cohorts', () => post('/api/dashboard/system-admin/customer-cohorts', auth.h.sys, {})],
    ['user route without token', () => g('/api/dashboard/cms-data', {})],
    ['system-admin route with user token', () => g('/api/dashboard/system-admin', auth.h.admin)],
    ['insights with user token', () => post('/api/dashboard/system-admin/insights', auth.h.admin, {})],
    ['case-insensitive legacy path', () => g(`/api/dashboard/getcmsstatuscount?${range}`, auth.h.admin)],
  ];

  it.each(CASES)('%s', async (name, mk) => {
    const r = await runParity(p, mk());
    statuses[name] = r.raw.a.status;
    if (name.includes('insights') && r.raw.a.status === 200) {
      // legacy insights.controller keeps a per-process 60s cache; both sides share this test
      // process, so the 2nd call is "(cached)". Per-process behaviour in prod is identical.
      for (const x of [r.legacy, r.next]) {
        x.body = x.body.replace('Insights fetched (cached)', 'Insights fetched');
        delete x.headers.etag; delete x.headers['content-length'];
      }
      expect(JSON.parse(r.raw.b.body).message).toBe('Insights fetched (cached)');
    }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
  });

  it('most handlers reach a success path on the in-memory DB (parity is not only on 500s)', () => {
    const ok = Object.entries(statuses).filter(([, s]) => s === 200).map(([n]) => n);
    if (process.env.SHOW) console.info(statuses);
    expect(ok.length).toBeGreaterThanOrEqual(8);
  });
});
