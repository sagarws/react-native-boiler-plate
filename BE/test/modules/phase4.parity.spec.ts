import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import authRouter from '@legacy/routes/Auth/auth.route';
import orderRouter from '@legacy/routes/Order/order.routes';
import * as sharedLimiters from '@legacy/middleware/authRateLimit.middleware';
import Company from '@legacy/models/Company/company.model';
import { PlatformsModule } from '../../src/modules/platforms/platforms.module';
import { OrderModule } from '../../src/modules/order/order.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { routesOf, smokeCases, runParity } from '../support/route-smoke';

const PLATFORMS = ['ajio', 'myntra', 'flipkart', 'tatacliq', 'snapdeal', 'delhivery', 'xbees', 'meesho', 'nykaa'];
const platformRouter = (d: string) => {
  const dir = { ajio: 'Ajio', myntra: 'Myntra', flipkart: 'Flipkart', tatacliq: 'TataCliq', snapdeal: 'Snapdeal', delhivery: 'Delhivery', xbees: 'Xbees', meesho: 'Meesho', nykaa: 'Nykaa' }[d];
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(`../../legacy/src/routes/${dir}/${d}.routes`).default;
};

/**
 * In production legacy and new are separate processes with separate rate-limit stores. Here both
 * load the same module, so give the legacy router its own limiter instances (fresh copy of the
 * small authRateLimit module only — no models are reloaded).
 */
const isolateLegacyLimiters = (router: any) => {
  let fresh: any;
  jest.isolateModules(() => { fresh = require('../../legacy/src/middleware/authRateLimit.middleware'); });
  const swap = new Map<any, any>(Object.keys(sharedLimiters).map((k) => [(sharedLimiters as any)[k], fresh[k]]));
  let swapped = 0;
  for (const layer of router.stack) for (const l of layer.route?.stack || []) if (swap.has(l.handle)) { l.handle = swap.get(l.handle); swapped++; }
  return swapped;
};

@Module({ imports: [PlatformsModule, OrderModule, AuthModule] })
class M {}

const ROUTES = [
  ...PLATFORMS.flatMap((d) => routesOf(`src/modules/platforms/${d}/${d}.controller.ts`, `/api/${d}`)),
  ...routesOf('src/modules/order/order.controller.ts', '/api/order'),
  ...routesOf('src/modules/auth/auth.controller.ts', '/api/auth'),
];

describe('Phase 4 route-smoke parity: platforms, Order, Auth', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    spies.push(jest.spyOn(Queue.prototype, 'add').mockImplementation((async () => ({ id: 'job' })) as any));
    auth = seedAuth();
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    expect(isolateLegacyLimiters(authRouter)).toBeGreaterThanOrEqual(2);
    p = await startPair([
      ...PLATFORMS.map((d) => [`/api/${d}`, platformRouter(d)] as [string, any]),
      ['/api/order', orderRouter], ['/api/auth', authRouter],
    ], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const tok = (k: 'admin' | 'sys') => ({ get authorization() { return `Bearer ${k === 'admin' ? auth.tokens.admin : auth.tokens.sys}`; } }) as any;
  const CASES = smokeCases(ROUTES, { anon: {}, admin: tok('admin'), sysadmin: tok('sys') });

  it('covers every generated route', () => expect(ROUTES.length).toBe(18 + 19 + 24));

  it.each(CASES)('%s', async (name, mk, opts) => {
    const req = mk();
    if (req.headers.authorization) req.headers = { ...req.headers, authorization: String(req.headers.authorization) };
    const r = await runParity(p, req, opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) { const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++; process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 150), i + 100)}\nN: ${b.slice(Math.max(0, i - 150), i + 100)}\n`); }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('status mix', () => {
    const counts: Record<string, number> = {};
    Object.values(statuses).forEach((s) => (counts[s] = (counts[s] || 0) + 1));
    if (process.env.SHOW) process.stdout.write(JSON.stringify(counts) + '\n');
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(4);
  });
});

describe('Auth targeted parity (login, rate limit, logout revocation)', () => {
  const bcrypt = require('bcrypt');
  const jwt = require('jsonwebtoken');
  const { User } = require('@legacy/models/User/user.model');
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const at = new Date('2026-01-01T00:00:00.000Z');
  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    const hash = bcrypt.hashSync('Secret#123', 4);
    const rows = memoryDb.collections.get(User.collection.collectionName).rows;
    Object.assign(rows.find((r: any) => r.email === 'admin@x.io'), { password: hash, isEmailVerified: true, name: { fullName: 'Ad Min' } });
    memoryDb.seed(User, [
      { email: 'disabled@x.io', password: hash, isEmailVerified: true, isDisable: true, role: auth.roleAdmin._id, companyId: auth.companyId },
      { email: 'unverified@x.io', password: hash, isEmailVerified: false, isDisable: false, role: auth.roleAdmin._id, companyId: auth.companyId },
    ]);
    isolateLegacyLimiters(authRouter);
    p = await startPair([['/api/auth', authRouter]], AuthModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const login = (email: string, password: string) => ({ method: 'POST', path: '/api/auth/login', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });

  it.each([
    ['ok', 'admin@x.io', 'Secret#123'],
    ['wrong password', 'admin@x.io', 'nope'],
    ['unknown user', 'ghost@x.io', 'Secret#123'],
    ['disabled user', 'disabled@x.io', 'Secret#123'],
    ['unverified email', 'unverified@x.io', 'Secret#123'],
  ])('login %s', async (_n, email, pw) => {
    const r = await runParity(p, login(email, pw), { volatile: ['accessToken'] });
    expect(r.next).toEqual(r.legacy);
    expect(r.nextDb).toEqual(r.legacyDb);
    if (r.raw.a.status === 200) {
      const claims = (b: string) => { const { iat, exp, jti, ...rest } = jwt.verify(JSON.parse(b).data.accessToken, process.env.JWT_SECRET); return { rest, ttl: exp - iat, hasJti: !!jti }; };
      expect(claims(r.raw.b.body)).toEqual(claims(r.raw.a.body));
    }
  });

  it('11th failed login for the same email+ip → 429 on both (separate stores)', async () => {
    const run = async (port: number) => { const out: number[] = []; for (let i = 0; i < 11; i++) out.push((await require('../support/parity').send(port, login('ratelimit@x.io', 'bad'))).status); return out; };
    const a = await run(p.legacyPort);
    const b = await run(p.newPort);
    expect(b).toEqual(a);
    expect(a[10]).toBe(429);
  });

  it('logout on the new server revokes the token for both servers', async () => {
    const { send } = require('../support/parity');
    const lr = await send(p.newPort, login('admin@x.io', 'Secret#123'));
    const token = JSON.parse(lr.body).data.accessToken;
    const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    // change-password is behind authMiddleware; an empty body passes auth and fails validation
    const protectedReq = { method: 'POST', path: '/api/auth/change-password', headers: h, body: '{}' };
    expect((await send(p.newPort, protectedReq)).status).not.toBe(401);
    expect((await send(p.newPort, { method: 'POST', path: '/api/auth/logout', headers: h, body: '{}' })).status).toBe(200);
    const after = await Promise.all([send(p.legacyPort, protectedReq), send(p.newPort, protectedReq)]);
    expect(after.map((x: any) => [x.status, x.body])).toEqual([[401, after[0].body], [401, after[0].body]]);
    expect(JSON.parse(after[1].body).message).toBe('Session ended.');
  });
});

describe('⚠ CRITICAL legacy behaviour reproduced: GET /api/auth/user-profile issues a token by email, unauthenticated', () => {
  // Documented so that fixing legacy (and bumping the pin) makes this test fail on purpose.
  const { User } = require('@legacy/models/User/user.model');
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let spies: jest.SpyInstance[];
  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1d';
    auth = seedAuth();
    memoryDb.useAll();
    void User;
    isolateLegacyLimiters(authRouter);
    p = await startPair([['/api/auth', authRouter]], AuthModule);
  });
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  it('same response on both servers, and it contains an access token', async () => {
    const r = await runParity(p, { method: 'GET', path: '/api/auth/user-profile?email=ADMIN@x.io' }, { volatile: ['accessToken'] });
    expect(r.next).toEqual(r.legacy);
    expect(r.raw.a.status).toBe(200);
    expect(typeof JSON.parse(r.raw.b.body).data.accessToken).toBe('string');
  });
});
