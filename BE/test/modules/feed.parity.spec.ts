import mongoose from 'mongoose';
import feedRouter from '@legacy/routes/Feed/feed.routes';
import Feed from '@legacy/models/Feed/feed.model';
import Company from '@legacy/models/Company/company.model';
import { FeedUser } from '@legacy/models/User/feedUser.model';
import { User } from '@legacy/models/User/user.model';
import { FeedModule } from '../../src/modules/feed/feed.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

describe('Feed parity (/api/feed) — delegated legacy handlers', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const oid = () => new mongoose.Types.ObjectId();
  const feed1 = oid();
  const feed2 = oid();
  const feedUser1 = oid();
  const at = new Date('2026-01-01T00:00:00.000Z');
  // random password / user code generated on create; timestamps on writes
  const writes: ParityOpts = { creates: true, volatile: ['password', 'userName', 'username', 'code', 'feedCode', 'loginId'] };
  const upd: ParityOpts = { volatile: ['updatedAt'] };

  beforeAll(async () => {
    spies = ['error', 'log', 'warn'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    auth.grant('feed::view');
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', settings: { compressPercentage: 'similar', backupDuration: 60, returnConditionPopup: { isShow: false }, eCommercePlatform: ['Ajio'] }, createdAt: at }]);
    memoryDb.seed(Feed, [
      { _id: feed1, feedName: 'Packing 1', companyId: auth.companyId, cameraType: 'webcam', isDeleted: false, isDisable: false, createdBy: auth.userAdmin._id, createdAt: at, updatedAt: at, __v: 0 },
      { _id: feed2, feedName: 'Packing 2', companyId: auth.companyId, cameraType: 'ip', isDeleted: false, isDisable: true, createdBy: auth.userAdmin._id, createdAt: at, updatedAt: at, __v: 0 },
      { feedName: 'Other co', companyId: oid(), isDeleted: false, createdAt: at, updatedAt: at, __v: 0 },
    ]);
    memoryDb.seed(FeedUser, [{ _id: feedUser1, feedId: feed1, companyId: auth.companyId, userName: 'packer1', role: auth.roleAdmin._id, isDisable: false, createdAt: at, updatedAt: at }]);
    void User;
    p = await startPair([['/api/feed', feedRouter]], FeedModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object, body?: object): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body ? JSON.stringify(body) : undefined });
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['list feeds', () => j('POST', '/api/feed', auth.h.admin, { page: 1, limit: 10 })],
    ['list feeds custom role with feed::view', () => j('POST', '/api/feed', auth.h.noPerm, { page: 1, limit: 10 })],
    ['list feeds no body', () => j('POST', '/api/feed', auth.h.admin)],
    ['add feed (creates feed + feed user)', () => j('POST', '/api/feed/add-update', auth.h.admin, { feedName: 'New Cam', companyId: String(auth.companyId), cameraType: 'webcam' }), writes],
    ['update feed', () => j('POST', '/api/feed/add-update', auth.h.admin, { feedId: String(feed1), feedName: 'Renamed', companyId: String(auth.companyId) }), upd],
    ['add-update without edit perm → 403', () => j('POST', '/api/feed/add-update', auth.h.noPerm, { feedName: 'X' })],
    ['delete feeds (DELETE with JSON body)', () => j('DELETE', '/api/feed/delete', auth.h.admin, { id: [String(feed2)] }), upd],
    ['delete without body', () => j('DELETE', '/api/feed/delete', auth.h.admin), upd],
    ['disable feed', () => j('POST', '/api/feed/disable', auth.h.admin, { id: String(feed1) }), upd],
    ['enable feed', () => j('POST', '/api/feed/enable', auth.h.admin, { id: String(feed2) }), upd],
    ['feed-user by id', () => j('GET', `/api/feed/feed-user/${feedUser1}`, auth.h.admin), upd],
    ['feed-user unknown → error', () => j('GET', `/api/feed/feed-user/${oid()}`, auth.h.admin)],
    ['common feed', () => j('GET', '/api/feed/common-feed', auth.h.admin)],
    ['camera-date permission get', () => j('GET', `/api/feed/camera-date-change-permission/${feed1}`, auth.h.admin)],
    ['camera-date permission change (sysadmin)', () => j('POST', '/api/feed/change-camera-date-change-permission', auth.h.sys, { feedId: String(feed1), allowCameraDateChange: true }), upd],
    ['camera-date permission change as user → 401', () => j('POST', '/api/feed/change-camera-date-change-permission', auth.h.admin, {})],
    ['no token', () => j('POST', '/api/feed', {}, {})],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('success paths are exercised', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1));
    expect(Object.values(statuses).filter((s) => s === 200).length).toBeGreaterThanOrEqual(9);
  });
});
