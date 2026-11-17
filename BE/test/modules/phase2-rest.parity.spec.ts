import mongoose from 'mongoose';
import { Module } from '@nestjs/common';
import accountRouter from '@legacy/routes/Account/account.routes';
import videoLinkRouter from '@legacy/routes/VideoLink/videoLink.routes';
import referralRouter from '@legacy/routes/Referral/referral.routes';
import creditsRouter from '@legacy/routes/Credits/credits.routes';
import Credit from '@legacy/models/Credits/credit.model';
import Plan from '@legacy/models/Plan/plan.model';
import Order from '@legacy/models/Order/order.model';
import File from '@legacy/models/File/file.model';
import { User } from '@legacy/models/User/user.model';
import { Referral } from '@legacy/models/Referral/referral.model';
import { AccountModule } from '../../src/modules/account/account.module';
import { VideoLinkModule } from '../../src/modules/video-link/video-link.module';
import { ReferralModule } from '../../src/modules/referral/referral.module';
import { CreditsModule } from '../../src/modules/credits/credits.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { send, Req } from '../support/parity';

@Module({ imports: [AccountModule, VideoLinkModule, ReferralModule, CreditsModule] })
class M {}

describe('Account / VideoLink / Referral / Credits parity', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const oid = () => new mongoose.Types.ObjectId();
  const otherCompanyUser = { _id: oid(), name: 'Lone', email: 'lone@x.io', role: null as any, companyId: oid(), isDisable: false, isDeleted: false };

  beforeAll(async () => {
    spies = ['error', 'log'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    process.env.FRONTEND_URL = 'https://app.example.com/';
    auth = seedAuth();
    otherCompanyUser.role = auth.roleAdmin._id;
    memoryDb.use(Credit, Plan, Order, File, Referral);
    memoryDb.seed(User, [otherCompanyUser]);
    auth.grant('video_link::view');
    const at = new Date('2026-01-01T00:00:00.000Z');
    memoryDb.seed(Credit, [{ companyId: auth.companyId, totalCredit: 500, usedCredit: 100, remainingCredit: 400, totalStorage: 1024, usedStorage: 10.5, remainingStorage: 1013.5, createdAt: at, updatedAt: at }]);
    const fileId = oid();
    memoryDb.seed(File, [{ _id: fileId, companyId: auth.companyId, size: 100, fileName: 'v.mp4', key: 'videos/v.mp4' }]);
    memoryDb.seed(Order, [
      { companyId: auth.companyId, trackingId: 'AWB123', orderNo: 'ORD-9', fileId, orderType: 'Forward', isDeleted: false, createdAt: at },
      { companyId: oid(), trackingId: 'AWB123', orderNo: 'ORD-9', fileId, isDeleted: false, createdAt: at },
    ]);
    const friend = { _id: oid(), name: { fullName: 'Friend One' }, email: 'friend@x.io', createdAt: at, role: auth.roleAdmin._id, companyId: oid() };
    memoryDb.seed(User, [friend]);
    memoryDb.seed(Referral, [
      { referrerId: auth.userAdmin._id, referredUserId: friend._id, status: 'rewarded', firstRechargeAmount: 1000, referrerBonusCredits: 50, rewardedAt: at, createdAt: at },
      { referrerId: auth.userAdmin._id, referredUserId: oid(), status: 'joined', createdAt: new Date('2026-02-01T00:00:00Z') },
    ]);
    // admin already has a referral code (deterministic); the other user gets one generated
    const urows = memoryDb.collections.get(User.collection.collectionName).rows;
    urows.find((r) => r.email === 'admin@x.io').referralCode = 'ADMIN123';
    memoryDb.seed(Plan, [{ name: 'S', type: 'Storage', price: 100, storage: 2048 }]);
    p = await startPair([
      ['/api/account', accountRouter], ['/api/video-link', videoLinkRouter], ['/api/referrals', referralRouter], ['/api/credit', creditsRouter],
    ], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const g = (path: string, h: object = auth.h.admin): Req => ({ method: 'GET', path, headers: h as any });
  const sign = (u: any) => require('jsonwebtoken').sign({ id: String(u._id), role: String(u.role), companyId: String(u.companyId) }, process.env.JWT_SECRET);
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['account usage', () => g('/api/account/usage')],
    ['account usage, company without credit doc → 500', () => g('/api/account/usage', { authorization: `Bearer ${sign(otherCompanyUser)}` })],
    ['account usage no token', () => g('/api/account/usage', {})],
    ['video-link search AWB', () => g('/api/video-link/search?q=AWB123')],
    ['video-link search order no', () => g('/api/video-link/search?q=ORD-9')],
    ['video-link no match', () => g('/api/video-link/search?q=nothing')],
    ['video-link empty q → 400', () => g('/api/video-link/search?q=%20')],
    ['video-link too long → 400', () => g(`/api/video-link/search?q=${'x'.repeat(101)}`)],
    ['video-link q array', () => g('/api/video-link/search?q[]=AWB123')],
    ['video-link custom role with permission', () => g('/api/video-link/search?q=AWB123', auth.h.noPerm)],
    ['video-link no token', () => g('/api/video-link/search?q=AWB123', {})],
    ['referral summary (existing code)', () => g('/api/referrals/summary')],
    ['referral summary generates code', () => g('/api/referrals/summary', { authorization: `Bearer ${sign(otherCompanyUser)}` }), { volatile: ['referralCode', 'referralLink'] }],
    ['referral no token', () => g('/api/referrals/summary', {})],
  ];

  it.each(CASES)('%s', async (_n, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    if (!opts.volatile) expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('credit/upgrade-storage hangs on both (legacy passes the adminAuth factory as middleware)', async () => {
    const r: Req = { method: 'PUT', path: '/api/credit/upgrade-storage', headers: { ...auth.h.admin, 'content-type': 'application/json' }, body: '{}' };
    const withTimeout = (port: number) => Promise.race([send(port, r).then((x) => x.status), new Promise((res) => setTimeout(() => res('TIMEOUT'), 400))]);
    expect(await withTimeout(p.legacyPort)).toBe('TIMEOUT');
    expect(await withTimeout(p.newPort)).toBe('TIMEOUT');
  });

  it('real data paths are exercised', async () => {
    const u = JSON.parse((await runParity(p, g('/api/account/usage'))).raw.b.body);
    expect(u.data).toEqual({ storage: { used: 10.5, total: 1024, remaining: 1013.5 }, credit: { used: 100, total: 500, remaining: 400 } });
    const v = JSON.parse((await runParity(p, g('/api/video-link/search?q=AWB123'))).raw.b.body);
    expect(v.data.length).toBe(1);
    const ref = JSON.parse((await runParity(p, g('/api/referrals/summary'))).raw.b.body);
    expect(ref.data).toMatchObject({ referralCode: 'ADMIN123', referralLink: 'https://app.example.com/auth/register?ref=ADMIN123', stats: { totalReferrals: 2, joinedCount: 1, rewardedCount: 1, totalBonusEarned: 50 } });
    expect(ref.data.history[1]).toMatchObject({ friendName: 'Friend One', friendEmail: 'fr••••@x.io' });
  });
  it('video-link rate limit: 61st request in a minute → 429 on both', async () => {
    const statuses = async (port: number) => {
      const out: number[] = [];
      for (let i = 0; i < 61; i++) out.push((await send(port, g('/api/video-link/search?q=%20'))).status);
      return out;
    };
    const a = await statuses(p.legacyPort);
    const b = await statuses(p.newPort);
    expect(b).toEqual(a);
    expect(a[60]).toBe(429);
  });
});
