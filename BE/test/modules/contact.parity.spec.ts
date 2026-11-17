import mongoose from 'mongoose';
import contactRouter from '@legacy/routes/Contact/contact.routes';
import Contact from '@legacy/models/Contact/contact.model';
import { ContactModule } from '../../src/modules/contact/contact.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

describe('Contact module parity (/api/contacts)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let errSpy: jest.SpyInstance;
  const at = new Date('2026-01-01T00:00:00.000Z');
  const creates: ParityOpts = { creates: true };

  beforeAll(async () => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    auth = seedAuth();
    memoryDb.seed(Contact, [
      { name: 'A', email: 'a@x.io', phone: '9999999999', companyId: auth.companyId, isDeleted: false, createdAt: at, updatedAt: at, __v: 0 },
      { name: 'B', email: 'b@x.io', phone: '8888888888', companyId: auth.companyId, isDeleted: true, createdAt: at, updatedAt: at, __v: 0 },
      { name: 'C', email: 'c@x.io', phone: '7777777777', companyId: new mongoose.Types.ObjectId(), isDeleted: false, createdAt: at, updatedAt: at, __v: 0 },
    ]);
    p = await startPair([['/api/contacts', contactRouter]], ContactModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { errSpy.mockRestore(); await p.close(); memoryDb.uninstall(); });

  const post = (headers: object, body: object): Req => ({ method: 'POST', path: '/api/contacts/create', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['list own company contacts', () => ({ method: 'GET', path: '/api/contacts', headers: auth.h.admin })],
    ['list via ?token=', () => ({ method: 'GET', path: `/api/contacts?token=${auth.tokens.admin}` })],
    ['list no token', () => ({ method: 'GET', path: '/api/contacts' })],
    ['list sysadmin token (not a user) → 401', () => ({ method: 'GET', path: '/api/contacts', headers: auth.h.sys })],
    ['create ok (email lowercased)', () => post(auth.h.admin, { name: 'New', email: 'New@X.io', phone: '9123456789' }), creates],
    ['create validation errors (all)', () => post(auth.h.admin, { name: '', email: 'bad', phone: '12' })],
    ['create missing everything', () => post(auth.h.admin, {})],
    ['create extra field → validation error', () => post(auth.h.admin, { name: 'N', email: 'n@x.io', phone: '9123456789', x: 1 })],
    ['create no token (auth before validation)', () => post(auth.h.none, {})],
    ['PUT update/:id (commented out in legacy) → 404', () => ({ method: 'PUT', path: '/api/contacts/update/abc', headers: auth.h.admin })],
  ];

  it.each(CASES)('%s', async (_n, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('list returns only own, non-deleted contacts', async () => {
    const r = await runParity(p, { method: 'GET', path: '/api/contacts', headers: auth.h.admin });
    expect(JSON.parse(r.raw.b.body)).toMatchObject({ count: 1, isSuccess: true, data: [{ name: 'A' }] });
  });
});
