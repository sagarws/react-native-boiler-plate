import mongoose from 'mongoose';
import { Module } from '@nestjs/common';
import companyRouter from '@legacy/routes/Company/company.routes';
import appSettingRouter from '@legacy/routes/AppSetting/appSetting.route';
import Company from '@legacy/models/Company/company.model';
import AppSetting from '@legacy/models/AppSettings/appSettings.model';
import { CompanyModule } from '../../src/modules/company/company.module';
import { AppSettingModule } from '../../src/modules/app-setting/app-setting.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

@Module({ imports: [CompanyModule, AppSettingModule] })
class M {}

describe('Company + AppSetting parity — delegated legacy handlers', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');
  const upd: ParityOpts = { volatile: ['updatedAt'] };
  const creates: ParityOpts = { creates: true };
  const platforms = () => [
    { name: 'Ajio', tatPeriod: 30, typeOfClaims: [{ name: 'Custom', description: 'operator-set' }] },
    { name: 'Meesho', tatPeriod: 15, typeOfClaims: [] },
  ];

  beforeAll(async () => {
    spies = ['error', 'log', 'warn'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    auth.grant('settings::view');
    memoryDb.useAll();
    memoryDb.seed(Company, [
      { _id: auth.companyId, name: 'Acme', email: 'acme@x.io', createdAt: at, updatedAt: at, settings: { compressPercentage: 'similar', backupDuration: 60, eCommercePlatform: platforms() } },
      { _id: new mongoose.Types.ObjectId(), name: 'Other', email: 'o@x.io', createdAt: at, updatedAt: at, settings: { eCommercePlatform: platforms() } },
    ]);
    memoryDb.seed(AppSetting as any, [{ backupDurationRates: [{ days: 30, credits: 0 }], videoSizeRates: [], cmsCredits: 1, vmsCredits: 1, createdAt: at, updatedAt: at }]);
    p = await startPair([['/api/companies', companyRouter], ['/api/app-settings', appSettingRouter]], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object, body?: object): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body ? JSON.stringify(body) : undefined });
  const A = () => auth.h.admin;
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['company info', () => j('GET', '/api/companies?from=2026-01-01&to=2026-12-31', A())],
    ['company info no dates', () => j('GET', '/api/companies', A())],
    ['company update-settings (all companies)', () => j('GET', '/api/companies/update-settings', A()), upd],
    ['company update-claims (NO AUTH, all companies)', () => j('PUT', '/api/companies/update-claims', {}), creates],
    ['increff allocation', () => j('PUT', '/api/companies/increff-allocation', A(), { platform: 'Ajio', allowed: true }), creates],
    ['increff allocation empty body', () => j('PUT', '/api/companies/increff-allocation', A()), upd],
    ['company no token', () => j('GET', '/api/companies', {})],
    ['app-settings get (sysadmin)', () => j('GET', '/api/app-settings', auth.h.sys), creates],
    ['app-settings upsert', () => j('POST', '/api/app-settings', auth.h.sys, { backupDurationRates: [{ days: 30, rate: 1 }], videoSizeRates: [], cmsCredits: 5, vmsCredits: 2 }), creates],
    ['app-settings get as user → 401', () => j('GET', '/api/app-settings', A())],
    ['app-settings for admin', () => j('GET', '/api/app-settings/get-app-setting-for-admin', A())],
    ['app-settings for admin custom role', () => j('GET', '/api/app-settings/get-app-setting-for-admin', auth.h.noPerm)],
    ['claim-types', () => j('GET', '/api/app-settings/claim-types', A())],
    ['increff-qc-mapping user token → auth ok, sysadmin fails', () => j('POST', '/api/app-settings/increff-qc-mapping', A(), {})],
    ['increff-qc-mapping sysadmin token → authMiddleware fails', () => j('POST', '/api/app-settings/increff-qc-mapping', auth.h.sys, {})],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF) for (const [x, y, t] of [[r.legacy.body, r.next.body, 'body'], [JSON.stringify(r.legacyDb), JSON.stringify(r.nextDb), 'db']] as const) if (x !== y) {
      let i = 0; while (x[i] === y[i]) i++;
      process.stdout.write(`\nDIFF ${name} ${t} @${i}\nL: ${x.slice(Math.max(0, i - 150), i + 100)}\nN: ${y.slice(Math.max(0, i - 150), i + 100)}\n`);
    }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('update-claims really rewrites every company (documents the legacy risk)', async () => {
    const r = await runParity(p, j('PUT', '/api/companies/update-claims', {}), creates);
    expect(r.raw.b.status).toBe(200);
    const rows = memoryDb.rows(Company);
    expect(rows.every((c: any) => !c.settings.eCommercePlatform.some((x: any) => x.typeOfClaims.some((t: any) => t.name === 'Custom')))).toBe(true);
  });

  it('success paths are exercised', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
    expect(Object.values(statuses).filter((s) => s === 200).length).toBeGreaterThanOrEqual(8);
  });
});
