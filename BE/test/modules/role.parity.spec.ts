import mongoose from 'mongoose';
import roleRouter from '@legacy/routes/Role/role.routes';
import Role from '@legacy/models/Role/role.model';
import { RoleModule } from '../../src/modules/role/role.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

describe('Role module parity (/api/role)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let errSpy: jest.SpyInstance;
  const oid = () => new mongoose.Types.ObjectId();
  const ownRole = oid();
  const ownRole2 = oid();
  const sysRole = oid();
  const otherCompanyRole = oid();
  const at = new Date('2026-01-01T00:00:00.000Z');
  const upd: ParityOpts = { volatile: ['updatedAt'] };
  const creates: ParityOpts = { creates: true };

  beforeAll(async () => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    auth = seedAuth();
    auth.grant('manage_roles::view');
    memoryDb.seed(Role, [
      { _id: ownRole, name: 'Packer', description: 'packs', companyId: auth.companyId, createdBy: auth.userAdmin._id, permission: { order: { view: true } }, createdAt: at, updatedAt: at, __v: 0 },
      { _id: ownRole2, name: 'Viewer', companyId: auth.companyId, createdBy: auth.userAdmin._id, permission: {}, createdAt: at, updatedAt: at, __v: 0 },
      { _id: sysRole, name: 'Manager', systemKey: 'manager', companyId: auth.companyId, createdBy: auth.userAdmin._id, permission: {}, createdAt: at, updatedAt: at, __v: 0 },
      { _id: otherCompanyRole, name: 'Other', companyId: oid(), createdBy: oid(), permission: {}, createdAt: at, updatedAt: at, __v: 0 },
    ]);
    p = await startPair([['/api/role', roleRouter]], RoleModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { errSpy.mockRestore(); await p.close(); memoryDb.uninstall(); });

  const post = (path: string, headers: object, body: object): Req => ({ method: 'POST', path, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (path: string, headers: object): Req => ({ method: 'GET', path, headers: headers as any });

  const CASES: [string, () => Req, ParityOpts?][] = [
    ['add-role ok → 201', () => post('/api/role/add-role', auth.h.admin, { name: 'Dispatcher', description: 'd', permission: { order: { edit: true } } }), creates],
    ['add-role duplicate name → 400', () => post('/api/role/add-role', auth.h.admin, { name: 'Packer' })],
    ['add-role missing name → 500 (validation)', () => post('/api/role/add-role', auth.h.admin, { description: 'x' })],
    ['add-role without edit permission → 403', () => post('/api/role/add-role', auth.h.noPerm, { name: 'X' })],
    ['add-role no token → 401', () => post('/api/role/add-role', auth.h.none, { name: 'X' })],
    ['update-role ok', () => post(`/api/role/update-role/${ownRole}`, auth.h.admin, { name: 'Packer 2', description: 'new', permission: { a: { b: true } } }), upd],
    ['update-role same name as itself', () => post(`/api/role/update-role/${ownRole}`, auth.h.admin, { name: 'Packer' }), upd],
    ['update-role name taken → 400', () => post(`/api/role/update-role/${ownRole}`, auth.h.admin, { name: 'Viewer' })],
    ['update-role system role → 403', () => post(`/api/role/update-role/${sysRole}`, auth.h.admin, { name: 'M' })],
    ['update-role other company → 404', () => post(`/api/role/update-role/${otherCompanyRole}`, auth.h.admin, { name: 'M' })],
    ['update-role global admin role → 404', () => post(`/api/role/update-role/${auth.roleAdmin._id}`, auth.h.admin, { name: 'M' })],
    ['update-role unknown → 404', () => post(`/api/role/update-role/${oid()}`, auth.h.admin, { name: 'M' })],
    ['update-role invalid id → 500', () => post('/api/role/update-role/nope', auth.h.admin, { name: 'M' })],
    ['get-role ok', () => get(`/api/role/get-role/${ownRole}`, auth.h.admin)],
    ['get-role other company (legacy returns it)', () => get(`/api/role/get-role/${otherCompanyRole}`, auth.h.admin)],
    ['get-role unknown → 404', () => get(`/api/role/get-role/${oid()}`, auth.h.admin)],
    ['get-role invalid → 500', () => get('/api/role/get-role/xyz', auth.h.admin)],
    ['get-role custom role with view perm', () => get(`/api/role/get-role/${ownRole}`, auth.h.noPerm)],
    ['get-roles creates system roles + lists', () => get('/api/role/get-roles', auth.h.admin), creates],
    ['get-roles with email filter (matches nothing → 404)', () => get('/api/role/get-roles?email=a', auth.h.admin), creates],
    ['get-roles email as array', () => get('/api/role/get-roles?email[]=a', auth.h.admin), creates],
    ['get-roles no token', () => get('/api/role/get-roles', auth.h.none)],
    ['get-roles sysadmin token (adminAuth)', () => get('/api/role/get-roles', auth.h.sys), creates],
    ['GET add-role → 404 page', () => get('/api/role/add-role', auth.h.admin)],
  ];

  it.each(CASES)('%s', async (_n, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('get-roles really lists own + built-in roles', async () => {
    const r = await runParity(p, get('/api/role/get-roles', auth.h.admin), creates);
    const names = JSON.parse(r.raw.b.body).data.map((x: any) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Packer', 'Viewer', 'Manager']));
    expect(names.length).toBeGreaterThan(3);
  });
});
