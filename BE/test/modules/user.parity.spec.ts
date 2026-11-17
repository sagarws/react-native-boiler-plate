import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import userRouter from '@legacy/routes/User/user.routes';
import Company from '@legacy/models/Company/company.model';
import { User } from '@legacy/models/User/user.model';
import { UserModule } from '../../src/modules/user/user.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { multipart, send, Req } from '../support/parity';

describe('User parity (/api/user) — delegated legacy handlers', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');
  const upd: ParityOpts = { volatile: ['updatedAt'] };
  const creates: ParityOpts = { creates: true };

  beforeAll(async () => {
    spies = ['error', 'log', 'warn'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    auth.grant('settings::view');
    memoryDb.useAll();
    memoryDb.seed(Company, [{
      _id: auth.companyId, name: 'Acme', email: 'acme@x.io', createdAt: at,
      settings: { _id: new mongoose.Types.ObjectId(), compressPercentage: 'similar', backupDuration: 60, eCommercePlatform: [{ _id: new mongoose.Types.ObjectId(), name: 'Ajio', tatPeriod: 30, typeOfClaims: [] }], returnConditionPopup: { isShow: false, isRedirectOnBad: false } },
    }]);
    const rows = memoryDb.collections.get(User.collection.collectionName).rows;
    const admin = rows.find((r) => r.email === 'admin@x.io');
    Object.assign(admin, { password: bcrypt.hashSync('Secret#123', 4), name: { firstName: 'Ad', lastName: 'Min', fullName: 'Ad Min' }, createdAt: at, updatedAt: at });
    p = await startPair([['/api/user', userRouter]], UserModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object, body?: object): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body ? JSON.stringify(body) : undefined });
  const A = () => auth.h.admin;
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['get-user', () => j('GET', '/api/user/get-user', A())],
    ['get-user ?token=', () => j('GET', `/api/user/get-user?token=${auth.tokens.admin}`, {})],
    ['ecommerce-credentials', () => j('GET', '/api/user/ecommerce-credentials', A())],
    ['ecommerce-credentials no perm → 403', () => j('GET', '/api/user/ecommerce-credentials', auth.h.noPerm)],
    ['update-user', () => j('PUT', `/api/user/update-user/${auth.userAdmin._id}`, A(), { firstName: 'New', lastName: 'Name', phone: '9111111111' }), upd],
    ['update-user custom role ([""] perm) → 403', () => j('PUT', `/api/user/update-user/${auth.userAdmin._id}`, auth.h.noPerm, { firstName: 'X' })],
    ['create-billing', () => j('POST', '/api/user/create-billing', A(), { gstNumber: '27ABCDE1234F1Z5', address: 'Pune', companyName: 'Acme' }), creates],
    ['get-billing', () => j('GET', '/api/user/get-billing', A())],
    ['update-video-settings', () => j('POST', '/api/user/update-video-settings', A(), { compressPercentage: 'low', backupDuration: 30 }), upd],
    ['update-ecommerce-settings', () => j('POST', '/api/user/update-ecommerce-settings', A(), { eCommercePlatform: ['Ajio', 'Myntra'] }), upd],
    ['video-settings', () => j('GET', '/api/user/video-settings', A())],
    ['video-settings custom role with settings::view', () => j('GET', '/api/user/video-settings', auth.h.noPerm)],
    ['ecommerce-settings', () => j('GET', '/api/user/ecommerce-settings', A())],
    ['get-company-users', () => j('GET', '/api/user/get-company-users', A())],
    ['update-sub-user', () => j('PUT', `/api/user/update-sub-user/${auth.userNoPerm._id}`, A(), { firstName: 'Sub' }), upd],
    ['check-password ok', () => j('POST', '/api/user/check-password', A(), { password: 'Secret#123' })],
    ['check-password wrong', () => j('POST', '/api/user/check-password', A(), { password: 'nope' })],
    ['update-auto-bookmark', () => j('POST', '/api/user/update-auto-bookmark-video-settings', A(), { autoBookmark: true }), creates],
    ['get-auto-bookmark', () => j('GET', '/api/user/get-auto-bookmark-video-settings', A())],
    ['upload-logo bad mime (no auth on route) → 400', () => ({ method: 'POST', path: '/api/user/upload-logo', ...multipart([{ name: 'logo', filename: 'x.txt', type: 'text/plain', data: Buffer.from('x') }]) })],
    ['upload-logo no file, no user → handler error', () => ({ method: 'POST', path: '/api/user/upload-logo', ...multipart([{ name: 'x', value: '1' }]) })],
    ['no token', () => j('GET', '/api/user/video-settings', {})],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) {
      const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++;
      process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 120), i + 120)}\nN: ${b.slice(Math.max(0, i - 120), i + 120)}\n`);
    }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it.each([['GET', '/api/user/members'], ['DELETE', '/api/user/delete']])('%s %s hangs on both (adminAuth factory as middleware)', async (method, path) => {
    const r = j(method, path, A(), method === 'DELETE' ? { id: String(auth.userNoPerm._id) } : undefined);
    const t = (port: number) => Promise.race([send(port, r).then((x) => x.status), new Promise((res) => setTimeout(() => res('TIMEOUT'), 400))]);
    expect(await t(p.legacyPort)).toBe('TIMEOUT');
    expect(await t(p.newPort)).toBe('TIMEOUT');
  });

  it('success paths are exercised', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
    expect(Object.values(statuses).filter((s) => s === 200 || s === 201).length).toBeGreaterThanOrEqual(12);
  });
});
void mongoose;
