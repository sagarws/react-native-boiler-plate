import 'reflect-metadata';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

process.env.JWT_SECRET = 'test-secret';
process.env.EASY_ECOM_TOKEN = 'easy-token';
process.env.GET_VIDEO_TOKEN = 'video-token';

import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { User } from '@legacy/models/User/user.model';
import { FeedUser } from '@legacy/models/User/feedUser.model';
import Role from '@legacy/models/Role/role.model';
import { SystemAdmin as SystemAdminModel } from '@legacy/models/SystemAdmin/systemAdmin.model';
import { RevokedToken } from '@legacy/models/Auth/revokedToken.model';
import SupportAgent from '@legacy/models/SupportChat/supportAgent.model';
import { Post } from '../../src/core/http/routes';
import { createApp } from '../../src/bootstrap';
import {
  AdminAuth, Auth, EasyEcomAuth, GetVideoAuth, Legacy, NormalAuth, SupportAgentAuth, SystemAdmin, Validate,
  adminAuth, authMiddleware, easyEcomAuth, getVideoAuth, normalAuth, supportAgentAuth, systemAdminAuth,
  systemAdminRole, validationMiddleware,
} from '../../src/core/auth';
import { LegacyReq } from '../../src/core/legacy/legacy-req.decorator';
import { fakeModel } from '../support/fake-models';
import { pick, send, Req as R } from '../support/parity';

// ---- fixtures -------------------------------------------------------------------------------
const id = () => crypto.randomBytes(12).toString('hex');
const ROLE_ADMIN = { _id: id(), name: 'admin' }; // default role (no companyId)
const ROLE_CUSTOM = { _id: id(), name: 'packer', companyId: id(), permission: { order: { view: true } } };
const ROLE_NOPERM = { _id: id(), name: 'viewer', companyId: id(), permission: { order: { view: false } } };
const COMPANY = id();
const USER = { _id: id(), name: 'u', phone: '999', role: ROLE_ADMIN._id, isDisable: false, isDeleted: false };
const PACKER = { _id: id(), name: 'p', phone: '888', role: ROLE_CUSTOM._id, isDisable: false, isDeleted: false };
const VIEWER = { _id: id(), name: 'v', role: ROLE_NOPERM._id, isDisable: false, isDeleted: false };
const DISABLED = { _id: id(), name: 'd', role: ROLE_ADMIN._id, isDisable: true, isDeleted: false };
const PASSWORD_CHANGED = { _id: id(), name: 'c', role: ROLE_ADMIN._id, isDisable: false, sessionsValidAfter: new Date(Date.now() + 60_000) };
const FEED_USER = { _id: id(), name: 'f', role: ROLE_ADMIN._id, isDisable: false };
const SYSADMIN = { _id: id(), role: 'system-admin' };
const SUPPORT_ADMIN = { _id: id(), role: 'support' };
const AGENT = { _id: id(), email: 'a@x.io', name: 'Agent', status: 'active' };

const sign = (p: object, opts: jwt.SignOptions = {}) => jwt.sign(p, process.env.JWT_SECRET, opts);
const tok = {
  user: sign({ id: USER._id, role: ROLE_ADMIN._id, companyId: COMPANY }),
  packer: sign({ id: PACKER._id, role: ROLE_CUSTOM._id, companyId: COMPANY }),
  viewer: sign({ id: VIEWER._id, role: ROLE_NOPERM._id }),
  disabled: sign({ id: DISABLED._id, role: ROLE_ADMIN._id }),
  pwChanged: sign({ id: PASSWORD_CHANGED._id, role: ROLE_ADMIN._id }),
  revoked: sign({ id: USER._id, role: ROLE_ADMIN._id, n: 1 }),
  feed: sign({ id: FEED_USER._id }),
  expiredLegacy: sign({ id: USER._id, role: ROLE_ADMIN._id, expIn: Date.now() - 1000 }),
  expiredJwt: sign({ id: USER._id, role: ROLE_ADMIN._id }, { expiresIn: -10 }),
  wrongSecret: jwt.sign({ id: USER._id }, 'other'),
  sys: sign({ id: SYSADMIN._id }),
  sysSupport: sign({ id: SUPPORT_ADMIN._id }),
  sys2fa: sign({ id: SYSADMIN._id, purpose: '2fa-verify' }),
  agent: sign({ id: AGENT._id, purpose: 'support-agent' }),
  agentWrongPurpose: sign({ id: AGENT._id }),
  unknown: sign({ id: id(), role: ROLE_ADMIN._id }),
};
const revokedHash = crypto.createHash('sha256').update(tok.revoked).digest('hex');
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const schema = Joi.object({ name: Joi.string().required(), qty: Joi.number().default(1) });

// ---- legacy (Express) side ------------------------------------------------------------------
const echo = (req: any, res: any) => res.json({ user: req.user ?? null, companyId: req.companyId ?? null, role: req.role ?? null, body: req.body, agent: req.supportAgent?.email ?? null });
const buildExpress = () => {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.json({ limit: '5mb' }));
  app.get('/t/auth', authMiddleware, echo);
  app.get('/t/normal', normalAuth, echo);
  app.get('/t/admin', adminAuth(['order::view']), echo);
  app.get('/t/admin-none', adminAuth(), echo);
  app.get('/t/sys', systemAdminAuth, echo);
  app.get('/t/sys-only', systemAdminAuth, systemAdminRole('system-admin'), echo);
  app.get('/t/agent', supportAgentAuth, echo);
  app.get('/t/easy', easyEcomAuth, echo);
  app.get('/t/video', getVideoAuth, echo);
  app.post('/t/validate', authMiddleware, validationMiddleware(schema), echo);
  return app;
};

// ---- Nest side ------------------------------------------------------------------------------
const nestEcho = (req: any) => ({ user: req.user ?? null, companyId: req.companyId ?? null, role: req.role ?? null, body: req.body, agent: req.supportAgent?.email ?? null });
@Controller('t')
class AuthProbe {
  @Get('auth') @Auth() a(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('normal') @NormalAuth() b(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('admin') @AdminAuth(['order::view']) c(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('admin-none') @AdminAuth() c2(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('sys') @SystemAdmin() d(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('sys-only') @SystemAdmin('system-admin') e(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('agent') @SupportAgentAuth() f(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('easy') @EasyEcomAuth() g(@LegacyReq() r: any) { return nestEcho(r); }
  @Get('video') @GetVideoAuth() h(@LegacyReq() r: any) { return nestEcho(r); }
  @Post('validate') @Legacy(authMiddleware, validationMiddleware(schema)) i(@LegacyReq() r: any) { return nestEcho(r); }
}
@Module({ controllers: [AuthProbe] })
class AuthProbeModule {}
void Validate;

// ---- cases ----------------------------------------------------------------------------------
const get = (path: string, headers: Record<string, string> = {}): R => ({ method: 'GET', path, headers });
const CASES: [string, R][] = [
  ['auth: no token', get('/t/auth')],
  ['auth: malformed header', get('/t/auth', { authorization: 'Bearer' })],
  ['auth: wrong secret', get('/t/auth', bearer(tok.wrongSecret))],
  ['auth: jwt-expired', get('/t/auth', bearer(tok.expiredJwt))],
  ['auth: legacy expIn expired', get('/t/auth', bearer(tok.expiredLegacy))],
  ['auth: ok via header', get('/t/auth', bearer(tok.user))],
  ['auth: ok via ?token=', get(`/t/auth?token=${tok.user}`)],
  ['auth: feed user fallback', get('/t/auth', bearer(tok.feed))],
  ['auth: disabled user', get('/t/auth', bearer(tok.disabled))],
  ['auth: unknown user', get('/t/auth', bearer(tok.unknown))],
  ['auth: password changed → session ended', get('/t/auth', bearer(tok.pwChanged))],
  ['auth: revoked → session ended', get('/t/auth', bearer(tok.revoked))],
  ['normal: ?token= not accepted', get(`/t/normal?token=${tok.user}`)],
  ['normal: user', get('/t/normal', bearer(tok.user))],
  ['normal: system admin sets role', get('/t/normal', bearer(tok.sys))],
  ['normal: wrong secret', get('/t/normal', bearer(tok.wrongSecret))],
  ['admin: default admin role passes', get('/t/admin', bearer(tok.user))],
  ['admin: custom role with permission', get('/t/admin', bearer(tok.packer))],
  ['admin: custom role without permission → 403', get('/t/admin', bearer(tok.viewer))],
  ['admin: no permissions required', get('/t/admin-none', bearer(tok.viewer))],
  ['admin: disabled', get('/t/admin', bearer(tok.disabled))],
  ['admin: unknown user (null deref → 401)', get('/t/admin', bearer(tok.unknown))],
  ['admin: no token', get('/t/admin')],
  ['sys: ok', get('/t/sys', bearer(tok.sys))],
  ['sys: plain user rejected', get('/t/sys', bearer(tok.user))],
  ['sys: 2fa temp token', get('/t/sys', bearer(tok.sys2fa))],
  ['sys-only: system-admin', get('/t/sys-only', bearer(tok.sys))],
  ['sys-only: other sysadmin role → 403', get('/t/sys-only', bearer(tok.sysSupport))],
  ['agent: ok', get('/t/agent', bearer(tok.agent))],
  ['agent: ?token=', get(`/t/agent?token=${tok.agent}`)],
  ['agent: wrong purpose', get('/t/agent', bearer(tok.agentWrongPurpose))],
  ['easy: missing', get('/t/easy')],
  ['easy: no bearer part', get('/t/easy', { authorization: 'easy-token' })],
  ['easy: wrong', get('/t/easy', bearer('nope'))],
  ['easy: ok', get('/t/easy', bearer('easy-token'))],
  ['video: ok', get('/t/video', bearer('video-token'))],
  ['video: wrong', get('/t/video', bearer('easy-token'))],
  ['validate: invalid → 422', { method: 'POST', path: '/t/validate', headers: { ...bearer(tok.user), 'content-type': 'application/json' }, body: '{"qty":"x"}' }],
  ['validate: ok, defaults applied', { method: 'POST', path: '/t/validate', headers: { ...bearer(tok.user), 'content-type': 'application/json' }, body: '{"name":"a"}' }],
  ['validate: auth runs first', { method: 'POST', path: '/t/validate', headers: { 'content-type': 'application/json' }, body: '{"qty":"x"}' }],
];

describe('Auth guards = legacy middleware (parity vs Express)', () => {
  let legacy: http.Server;
  let nest: NestFastifyApplication;
  let lp: number;
  let np: number;
  const restore: (() => void)[] = [];
  let errSpy: jest.SpyInstance;

  beforeAll(async () => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    restore.push(
      fakeModel(User, [USER, PACKER, VIEWER, DISABLED, PASSWORD_CHANGED].map((u) => ({ ...u }))),
      fakeModel(FeedUser, [FEED_USER]),
      fakeModel(Role, [ROLE_ADMIN, ROLE_CUSTOM, ROLE_NOPERM]),
      fakeModel(SystemAdminModel, [SYSADMIN, SUPPORT_ADMIN]),
      fakeModel(RevokedToken, [{ tokenHash: revokedHash }]),
      fakeModel(SupportAgent, [AGENT]),
    );
    legacy = http.createServer(buildExpress());
    lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createApp(AuthProbeModule);
    await nest.listen(0, '127.0.0.1');
    np = (nest.getHttpServer().address() as any).port;
  });
  afterAll(async () => {
    restore.forEach((r) => r());
    errSpy.mockRestore();
    await nest.close();
    await new Promise((r) => legacy.close(r));
  });

  it.each(CASES)('%s', async (_name, r) => {
    const a = await send(lp, r);
    const b = await send(np, r);
    expect(pick(b)).toEqual(pick(a));
  });

  it('covers success and failure for every tier', async () => {
    const statuses = await Promise.all(CASES.map(([, r]) => send(lp, r).then((x) => x.status)));
    expect(new Set(statuses)).toEqual(new Set([200, 401, 403, 422]));
  });
});
