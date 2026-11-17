import mongoose from 'mongoose';
import planRouter from '@legacy/routes/plan/plan.routes';
import Plan from '@legacy/models/Plan/plan.model';
import { PlanModule } from '../../src/modules/plan/plan.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

describe('plan module parity (/api/plan)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  const planId = new mongoose.Types.ObjectId();
  const deletedId = new mongoose.Types.ObjectId();
  let errSpy: jest.SpyInstance;
  let initial: Map<string, any[]>;
  const upd: ParityOpts = { volatile: ['updatedAt'] };

  beforeAll(async () => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    auth = seedAuth();
    memoryDb.use(Plan);
    const at = new Date('2026-01-01T00:00:00.000Z');
    memoryDb.seed(Plan, [
      { _id: planId, name: 'Gold', type: 'Credit', price: 999, credit: 500, bonus: 50, isActive: true, isDeleted: false, isDefault: false, createdAt: at, updatedAt: at, __v: 0 },
      { name: 'Silver', type: 'Credit', price: 499, credit: 200, isDeleted: false, isDefault: false, createdAt: at, updatedAt: at },
      { name: 'Storage 10', type: 'Storage', price: 99, storage: 10485760, isDeleted: false, isDefault: false, createdAt: at, updatedAt: at },
      { name: 'Default', type: 'Credit', price: 0, credit: 10, isDeleted: false, isDefault: true, createdAt: at, updatedAt: at },
      { _id: deletedId, name: 'Old', type: 'Credit', price: 1, credit: 1, isDeleted: true, isDefault: false, createdAt: at, updatedAt: at },
    ]);
    p = await startPair([['/api/plan', planRouter]], PlanModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { errSpy.mockRestore(); await p.close(); memoryDb.uninstall(); });

  const json = (method: string, path: string, headers: object, body?: object): Req => ({
    method, path, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const get = (h: object): Req => ({ method: 'GET', path: '/api/plan', headers: h as any });

  const CASES: [string, () => Req, ParityOpts?][] = [
    ['GET list as default admin', () => get(auth.h.admin)],
    ['GET list without token', () => get(auth.h.none)],
    ['GET list bad token', () => get(auth.h.bad)],
    ['GET list custom role without permission → 403', () => get(auth.h.noPerm)],
    ['GET list as system admin (adminAuth) ', () => get(auth.h.sys)],
    ['POST create credit plan', () => json('POST', '/api/plan', auth.h.sys, { name: 'Bronze', price: 199, credit: 50, bonus: 5 }), { creates: true }],
    ['POST create storage plan (MB → bytes)', () => json('POST', '/api/plan', auth.h.sys, { name: 'S5', price: 49, storage: 5 }), { creates: true }],
    ['POST missing fields → 400', () => json('POST', '/api/plan', auth.h.sys, { name: 'X' })],
    ['POST price as string', () => json('POST', '/api/plan', auth.h.sys, { name: 'Str', price: '10', credit: '5' }), { creates: true }],
    ['POST invalid price → 500', () => json('POST', '/api/plan', auth.h.sys, { name: 'Bad', price: 'abc', credit: 5 })],
    ['POST as normal admin → 401', () => json('POST', '/api/plan', auth.h.admin, { name: 'B', price: 1, credit: 1 })],
    ['POST empty body', () => json('POST', '/api/plan', auth.h.sys, {})],
    ['PUT update', () => json('PUT', `/api/plan/${planId}`, auth.h.sys, { name: 'Gold+', price: 1099, isActive: false }), upd],
    ['PUT update storage', () => json('PUT', `/api/plan/${planId}`, auth.h.sys, { storage: 2 }), upd],
    ['PUT unknown id → 404', () => json('PUT', `/api/plan/${new mongoose.Types.ObjectId()}`, auth.h.sys, { name: 'n' })],
    ['PUT invalid id → 500', () => json('PUT', '/api/plan/not-an-id', auth.h.sys, { name: 'n' })],
    ['PUT without token', () => json('PUT', `/api/plan/${planId}`, auth.h.none, { name: 'n' })],
    ['DELETE soft-deletes', () => ({ method: 'DELETE', path: `/api/plan/${planId}`, headers: auth.h.sys }), upd],
    ['DELETE already deleted still returns doc', () => ({ method: 'DELETE', path: `/api/plan/${deletedId}`, headers: auth.h.sys }), upd],
    ['DELETE unknown → 404', () => ({ method: 'DELETE', path: `/api/plan/${new mongoose.Types.ObjectId()}`, headers: auth.h.sys })],
    ['DELETE invalid id → 500', () => ({ method: 'DELETE', path: '/api/plan/zzz', headers: auth.h.sys })],
    ['PATCH → 404 page', () => ({ method: 'PATCH', path: `/api/plan/${planId}`, headers: auth.h.sys })],
  ];

  it.each(CASES)("%s", async (_n, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('list really returns the non-default, non-deleted plans sorted by credit', async () => {
    const r = await runParity(p, get(auth.h.admin));
    expect(JSON.parse(r.raw.b.body).plans.map((x: any) => x.name)).toEqual(['Storage 10', 'Silver', 'Gold']);
  });
});
