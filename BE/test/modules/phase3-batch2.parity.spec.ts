import mongoose from 'mongoose';
import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import ecomRouter from '@legacy/routes/eCommercePlatform/eCommercePlatform.routes';
import skuRouter from '@legacy/routes/ProductSkucodeMap/ProductSkucodeMap.routes';
import masterSettingRouter from '@legacy/routes/MasterImportSetting/MasterImportSetting.routes';
import marketingRouter from '@legacy/routes/MarketingSite/marketingSite.routes';
import Company from '@legacy/models/Company/company.model';
import Plan from '@legacy/models/Plan/plan.model';
import AppSetting from '@legacy/models/AppSettings/appSettings.model';
import { ECommercePlatformModule } from '../../src/modules/ecommerce-platform/ecommerce-platform.module';
import { ProductSkucodeMapModule } from '../../src/modules/product-skucode-map/product-skucode-map.module';
import { MasterImportSettingModule } from '../../src/modules/master-import-setting/master-import-setting.module';
import { MarketingSiteModule } from '../../src/modules/marketing-site/marketing-site.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { send, Req } from '../support/parity';

@Module({ imports: [ECommercePlatformModule, ProductSkucodeMapModule, MasterImportSettingModule, MarketingSiteModule] })
class M {}

describe('eCommercePlatform / ProductSkucodeMap / MasterImportSetting / MarketingSite parity', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');
  const upd: ParityOpts = { volatile: ['updatedAt'] };
  const creates: ParityOpts = { creates: true };

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    spies.push(jest.spyOn(Queue.prototype, 'add').mockImplementation((async () => ({ id: 'job' })) as any)); // never enqueue
    auth = seedAuth();
    auth.grant('integrations::view');
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at, settings: { eCommercePlatform: [{ name: 'Ajio', tatPeriod: 30, typeOfClaims: [] }], eCommercePlatformLoginInfo: [] } }]);
    memoryDb.seed(Plan, [{ name: 'Gold', type: 'Credit', price: 999, credit: 500, isDeleted: false, isDefault: false, isActive: true, createdAt: at, updatedAt: at }]);
    memoryDb.seed(AppSetting as any, [{ backupDurationRates: [{ days: 30, credits: 0 }], videoSizeRates: [], cmsCredits: 1, vmsCredits: 1, createdAt: at, updatedAt: at }]);
    p = await startPair([
      ['/api/ecommerce-platform', ecomRouter], ['/api/product-skucode-map', skuRouter], ['/api/master-setting', masterSettingRouter], ['/api/marketing-site', marketingRouter],
    ], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object, body?: object): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body ? JSON.stringify(body) : undefined });
  const A = () => auth.h.admin;
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['ecom list', () => j('GET', '/api/ecommerce-platform', A())],
    ['ecom create', () => j('POST', '/api/ecommerce-platform/create-ecommerce-platform', A(), { name: 'Nykaa', tatPeriod: 15 }), creates],
    ['ecom update', () => j('POST', `/api/ecommerce-platform/update/${new mongoose.Types.ObjectId()}`, A(), { name: 'X' }), upd],
    ['ecom delete', () => j('DELETE', '/api/ecommerce-platform/delete', A(), { id: String(new mongoose.Types.ObjectId()) }), upd],
    ['ecom no token', () => j('GET', '/api/ecommerce-platform', {})],
    ['sku by awb', () => j('GET', `/api/product-skucode-map/AWB1/${auth.companyId}`, A())],
    ['sku all', () => j('POST', '/api/product-skucode-map/all', A(), { page: 1, limit: 10 })],
    ['sku upload without token (upload runs before auth)', () => j('POST', '/api/product-skucode-map', {})],
    ['master-setting active-deactive', () => j('GET', `/api/master-setting/active-deactive/${new mongoose.Types.ObjectId()}`, A()), upd],
    ['master-setting add-keys (all companies)', () => j('GET', '/api/master-setting/add-keys-settings', A()), creates],
    ['master-setting mark-credentials-unverified', () => j('POST', '/api/master-setting/mark-credentials-unverified', A(), { platform: 'Ajio' }), upd],
    ['master-setting remove-ajio-account', () => j('POST', '/api/master-setting/remove-ajio-account', A(), { username: 'nobody' }), upd],
    ['master-setting remove-ajio no perm → 403', () => j('POST', '/api/master-setting/remove-ajio-account', auth.h.noPerm, {})],
    ['master-setting sync-spf (unreachable chain) user token', () => j('POST', '/api/master-setting/sync-spf-tat-to-companies', A(), {})],
    ['master-setting sync-spf (unreachable chain) sysadmin token', () => j('POST', '/api/master-setting/sync-spf-tat-to-companies', auth.h.sys, {})],
    ['marketing plans', () => j('GET', '/api/marketing-site/plans', {})],
    ['marketing credit settings', () => j('GET', '/api/marketing-site/get-credit-settings', {})],
    ['marketing book-demo empty', () => j('POST', '/api/marketing-site/book-demo', {}, {}), creates],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) { const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++; process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 150), i + 100)}\nN: ${b.slice(Math.max(0, i - 150), i + 100)}\n`); }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('marketing rate limit: 7th call in a minute → 429 on both (per route, per server)', async () => {
    const run = async (port: number) => { const out: number[] = []; for (let i = 0; i < 7; i++) out.push((await send(port, j('GET', '/api/marketing-site/release', {}))).status); return out; };
    const a = await run(p.legacyPort);
    const b = await run(p.newPort);
    expect(b).toEqual(a);
    expect(a[6]).toBe(429);
  });

  it('success paths are exercised', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
    expect(Object.values(statuses).filter((s) => s === 200 || s === 201).length).toBeGreaterThanOrEqual(6);
  });
});
