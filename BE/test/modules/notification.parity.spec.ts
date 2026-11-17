import http from 'http';
import mongoose from 'mongoose';
import { NotificationRouter } from '@legacy/routes/Notification/notification.routes';
import { Notification } from '@legacy/models/Notification/notification.model';
import { NotificationModule } from '../../src/modules/notification/notification.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

describe('Notification parity (/api/notifications) — delegated, incl. SSE', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const n1 = new mongoose.Types.ObjectId();
  const at = (s: string) => new Date(s);
  const upd: ParityOpts = { volatile: ['updatedAt'] };

  beforeAll(async () => {
    spies = ['error', 'log', 'warn'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    memoryDb.useAll();
    memoryDb.seed(Notification as any, [
      { _id: n1, companyId: auth.companyId, message: 'Import done', description: 'd', is_read: false, is_archived: false, type: 'import', createdAt: at('2026-03-01T10:00:00Z'), updatedAt: at('2026-03-01T10:00:00Z') },
      { companyId: auth.companyId, message: 'Old', is_read: true, is_archived: true, type: 'x', createdAt: at('2026-02-01T10:00:00Z'), updatedAt: at('2026-02-01T10:00:00Z') },
      { companyId: new mongoose.Types.ObjectId(), message: 'Other co', is_read: false, is_archived: false, createdAt: at('2026-03-01T10:00:00Z'), updatedAt: at('2026-03-01T10:00:00Z') },
    ]);
    p = await startPair([['/api/notifications', NotificationRouter]], NotificationModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const g = (path: string, h: object = auth.h.admin): Req => ({ method: 'GET', path, headers: h as any });
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['list', () => g('/api/notifications')],
    ['mark-as-read', () => g(`/api/notifications/mark-as-read/${n1}`), upd],
    ['mark-as-read unknown', () => g(`/api/notifications/mark-as-read/${new mongoose.Types.ObjectId()}`), upd],
    ['mark-as-read invalid id', () => g('/api/notifications/mark-as-read/zz')],
    ['mark-all-as-read', () => g('/api/notifications/mark-all-as-read'), upd],
    ['archive', () => g(`/api/notifications/archive/${n1}`), upd],
    ['background-jobs', () => g('/api/notifications/background-jobs')],
    ['custom role (adminAuth([]))', () => g('/api/notifications', auth.h.noPerm)],
    ['no token', () => g('/api/notifications', {})],
    ['sse no token → 401', () => g('/api/notifications/sse', {})],
    ['sse sysadmin token → 401', () => g('/api/notifications/sse', auth.h.sys)],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('SSE: same headers + initial event, and live push after mark-all-as-read reaches both', async () => {
    const open = (port: number) => new Promise<{ res: http.IncomingMessage; events: string[]; req: http.ClientRequest }>((resolve) => {
      const events: string[] = [];
      const req = http.get({ host: '127.0.0.1', port, path: `/api/notifications/sse?token=${auth.tokens.admin}` }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { events.push(buf.slice(0, i)); buf = buf.slice(i + 2); } });
        resolve({ res, events, req });
      });
    });
    const a = await open(p.legacyPort);
    const b = await open(p.newPort);
    const wait = (cond: () => boolean) => new Promise<void>((r, j) => { const t0 = Date.now(); const i = setInterval(() => { if (cond()) { clearInterval(i); r(); } else if (Date.now() - t0 > 4000) { clearInterval(i); j(new Error('timeout')); } }, 20); });
    await wait(() => a.events.length >= 1 && b.events.length >= 1);
    const pickH = (r: http.IncomingMessage) => ['content-type', 'cache-control', 'connection', 'access-control-allow-origin', 'x-content-type-options'].map((k) => r.headers[k]);
    expect(b.res.statusCode).toBe(a.res.statusCode);
    expect(pickH(b.res)).toEqual(pickH(a.res));
    expect(b.events[0]).toBe(a.events[0]);
    expect(JSON.parse(a.events[0].slice(6)).map((x: any) => x.message)).toEqual(['Import done']);
    // mark-all-as-read → notifyCompany() → debounced push to every SSE client of the company
    await new Promise<void>((r) => http.get({ host: '127.0.0.1', port: p.newPort, path: '/api/notifications/mark-all-as-read', headers: auth.h.admin as any }, (res) => { res.resume(); res.on('end', () => r()); }));
    await wait(() => a.events.length >= 2 && b.events.length >= 2);
    expect(b.events[1]).toBe(a.events[1]);
    expect(JSON.parse(b.events[1].slice(6))[0].is_read).toBe(true);
    a.req.destroy(); b.req.destroy();
  });

  it('success paths are exercised', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
    expect(Object.values(statuses).filter((s) => s === 200).length).toBeGreaterThanOrEqual(6);
  });
});
