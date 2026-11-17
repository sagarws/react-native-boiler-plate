import 'reflect-metadata';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { securityHeaders } from '@legacy/middleware/securityHeaders.middleware';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import { logoUploader } from '@legacy/middleware/logoUploader.middleware';
import { supportAttachmentUploader } from '@legacy/middleware/supportAttachmentUploader.middleware';
import { Post } from '../../src/core/http/routes';
import { createApp } from '../../src/bootstrap';
import { Legacy } from '../../src/core/auth';
import { LegacyReq } from '../../src/core/legacy/legacy-req.decorator';
import { multipart, pick, send, Req as R } from '../support/parity';

/** Fresh copies of the legacy limiter modules, so legacy and Nest each get their own store (like two processes). */
const freshLimiters = () => {
  let m: any;
  jest.isolateModules(() => {
    m = {
      ...require('../../legacy/src/middleware/authRateLimit.middleware'),
      ...require('../../legacy/src/middleware/rateLimit.middleware'),
    };
  });
  return { login: m.loginRateLimiter, forgot: m.forgotPasswordRateLimiter, generic: m.rateLimiter({ windowMs: 60 * 1000, max: 6 }) };
};

const fileView = (f: any) => f && { fieldname: f.fieldname, originalname: f.originalname, encoding: f.encoding, mimetype: f.mimetype, size: f.size, destination: f.destination, filename: f.filename, path: f.path, buffer: f.buffer ? f.buffer.toString('base64') : undefined };
const view = (req: any) => ({ body: req.body, file: fileView(req.file) ?? null, files: req.files ? (Array.isArray(req.files) ? req.files.map(fileView) : Object.fromEntries(Object.entries(req.files).map(([k, v]: any) => [k, v.map(fileView)]))) : null, ip: req.ip });
const loginHandler = (req: any, res: any) => (req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ isSuccess: false, message: 'Invalid' }));

const buildExpress = (l: ReturnType<typeof freshLimiters>) => {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.json({ limit: '5mb' }));
  app.post('/m/login', l.login, loginHandler);
  app.post('/m/forgot', l.forgot, (req, res) => { res.json({ ok: true }); });
  app.get('/m/generic', l.generic, (req, res) => { res.json({ ok: true }); });
  app.post('/m/single', fileUploader.single('file'), (req, res) => { res.json(view(req)); });
  app.post('/m/fields', fileUploader.fields([{ name: 'a', maxCount: 1 }, { name: 'b', maxCount: 2 }]), (req, res) => { res.json(view(req)); });
  app.post('/m/logo', logoUploader, (req, res) => { res.json(view(req)); });
  app.post('/m/attachments', supportAttachmentUploader.array('attachments', 5), (req, res) => { res.json(view(req)); });
  return app;
};

const buildNestModule = (l: ReturnType<typeof freshLimiters>) => {
  @Controller('m')
  class MwProbe {
    @Post('login') @Legacy(l.login, loginHandler) a() { return undefined; }
    @Post('forgot') @Legacy(l.forgot) b() { return { ok: true }; }
    @Get('generic') @Legacy(l.generic) c() { return { ok: true }; }
    @Post('single') @Legacy(fileUploader.single('file')) d(@LegacyReq() r: any) { return view(r); }
    @Post('fields') @Legacy(fileUploader.fields([{ name: 'a', maxCount: 1 }, { name: 'b', maxCount: 2 }])) e(@LegacyReq() r: any) { return view(r); }
    @Post('logo') @Legacy(logoUploader) f(@LegacyReq() r: any) { return view(r); }
    @Post('attachments') @Legacy(supportAttachmentUploader.array('attachments', 5)) g(@LegacyReq() r: any) { return view(r); }
  }
  @Module({ controllers: [MwProbe] })
  class M {}
  return M;
};

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20, 1)]);
const up = (p: string, parts: Parameters<typeof multipart>[0]): R => ({ method: 'POST', path: p, ...multipart(parts) });
const jsonPost = (p: string, body: object): R => ({ method: 'POST', path: p, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
/** reset seconds can tick between the two calls */
const normalize = (x: ReturnType<typeof pick>) => {
  for (const h of ['ratelimit', 'x-ratelimit-reset', 'retry-after']) {
    const v = x.headers[h];
    if (typeof v === 'string') x.headers[h] = v.replace(/reset=\d+/, 'reset=N').replace(/^\d+$/, 'N');
  }
  return x;
};

describe('Rate-limit + upload middleware parity vs Express', () => {
  let legacy: http.Server;
  let nest: NestFastifyApplication;
  let lp: number;
  let np: number;
  const cwd = process.cwd();
  let errSpy: jest.SpyInstance;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nest-parity-'));
    fs.mkdirSync(path.join(dir, 'uploads'));
    process.chdir(dir); // multer disk storage writes to ./uploads
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    legacy = http.createServer(buildExpress(freshLimiters()));
    lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createApp(buildNestModule(freshLimiters()));
    await nest.listen(0, '127.0.0.1');
    np = (nest.getHttpServer().address() as any).port;
  });
  afterAll(async () => {
    process.chdir(cwd);
    errSpy.mockRestore();
    await nest.close();
    await new Promise((r) => legacy.close(r));
  });

  const same = async (r: R) => {
    const a = normalize(pick(await send(lp, r)));
    const b = normalize(pick(await send(np, r)));
    expect(b).toEqual(a);
    return a;
  };

  it('login limiter: 10 failures per email+ip, successes not counted, then 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await same(jsonPost('/m/login', { email: 'A@x.io', password: 'right' }))).status);
    for (let i = 0; i < 11; i++) statuses.push((await same(jsonPost('/m/login', { email: 'a@x.io ', password: 'wrong' }))).status);
    statuses.push((await same(jsonPost('/m/login', { email: 'other@x.io', password: 'wrong' }))).status);
    expect(statuses).toEqual([200, 200, 200, ...Array(10).fill(401), 429, 401]);
  });

  it('forgot-password limiter: 5 per hour then 429', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await same(jsonPost('/m/forgot', { email: 'z@x.io' }))).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('generic limiter (marketing site): 6 per minute then 429 text body', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await same({ method: 'GET', path: '/m/generic' })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  });

  it.each<[string, R]>([
    ['single file + fields', up('/m/single', [{ name: 'note', value: 'hi' }, { name: 'file', filename: 'orders.csv', type: 'text/csv', data: Buffer.from('a,b\n1,2\n') }])],
    ['single: unexpected field → multer error', up('/m/single', [{ name: 'other', filename: 'x.csv', data: Buffer.from('x') }])],
    ['single: no file', up('/m/single', [{ name: 'note', value: 'only text' }])],
    ['fields a+b', up('/m/fields', [{ name: 'a', filename: 'a.xlsx', data: Buffer.from('A') }, { name: 'b', filename: 'b1.csv', data: Buffer.from('B1') }, { name: 'b', filename: 'b2.csv', data: Buffer.from('B2') }])],
    ['fields: too many b', up('/m/fields', [{ name: 'b', filename: '1', data: Buffer.from('1') }, { name: 'b', filename: '2', data: Buffer.from('2') }, { name: 'b', filename: '3', data: Buffer.from('3') }])],
    ['logo ok (memory storage)', up('/m/logo', [{ name: 'logo', filename: 'l.png', type: 'image/png', data: PNG }])],
    ['logo wrong mime → 400 JSON', up('/m/logo', [{ name: 'logo', filename: 'l.txt', type: 'text/plain', data: Buffer.from('x') }])],
    ['logo too big → 400 JSON', up('/m/logo', [{ name: 'logo', filename: 'l.png', type: 'image/png', data: Buffer.alloc(2 * 1024 * 1024 + 1) }])],
    ['attachments ok', up('/m/attachments', [{ name: 'attachments', filename: 'a.pdf', type: 'application/pdf', data: Buffer.from('%PDF') }, { name: 'msg', value: 'hello' }])],
    ['attachments bad mime → error page', up('/m/attachments', [{ name: 'attachments', filename: 'a.exe', type: 'application/x-msdownload', data: Buffer.from('MZ') }])],
    ['json body on upload route', jsonPost('/m/single', { a: 1 })],
  ])('%s', async (_n, r) => {
    await same(r);
  });
});
