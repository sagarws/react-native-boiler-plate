import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { Module } from '@nestjs/common';
import templateRouter from '@legacy/routes/Template/template.routes';
import tdsRouter from '@legacy/routes/TDS/tds.routes';
import Template from '@legacy/models/Template/template.model';
import TDS from '@legacy/models/TDS/tds.model';
import { S3Service } from '@legacy/utils/s3';
import { TemplateModule } from '../../src/modules/template/template.module';
import { TdsModule } from '../../src/modules/tds/tds.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { multipart, Req } from '../support/parity';

@Module({ imports: [TemplateModule, TdsModule] })
class M {}

describe('Template + TDS parity — delegated legacy handlers', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const uploads: string[] = [];
  const cwd = process.cwd();
  const tpl1 = new mongoose.Types.ObjectId();
  const tds1 = new mongoose.Types.ObjectId();
  const at = new Date('2026-01-01T00:00:00.000Z');
  const upd: ParityOpts = { volatile: ['updatedAt'] };
  const creates: ParityOpts = { creates: true, volatile: ['tdsCertificate', 'attachment', 'url'] };

  beforeAll(async () => {
    // run from the legacy root like main.ts does, so multer's ./uploads == utils/files.ts's uploads dir
    process.chdir(path.resolve(cwd, 'legacy'));
    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
    void os;
    spies = ['error', 'log', 'warn'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    // never reach AWS from tests
    spies.push(jest.spyOn(S3Service.prototype as any, 'uploadObject').mockImplementation((async (_f: any, key: any) => { uploads.push(String(key)); return {}; }) as any));
    auth = seedAuth();
    auth.grant('email::view');
    memoryDb.useAll();
    memoryDb.seed(Template as any, [{ _id: tpl1, userId: String(auth.userAdmin._id), name: 'Ajio reply', subject: 'Hi', body: 'Hello {{name}}', provider: 'ajio', status: 'active', createdAt: at, updatedAt: at }]);
    memoryDb.seed(TDS as any, [{ _id: tds1, company: auth.companyId, companyId: auth.companyId, duration: { quarter: 1, year: 2026 }, companyName: 'Acme', tanNumber: 'T', panNumber: 'P', accountNumber: '1', ifsc: 'I', accountHolderName: 'A', tdsAmount: 100, status: 'pending', createdAt: at, updatedAt: at }]);
    p = await startPair([['/api/templates', templateRouter], ['/api/tds', tdsRouter]], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { try { fs.unlinkSync('uploads/cert.pdf'); } catch { /* not created */ } process.chdir(cwd); spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object, body?: object): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body ? JSON.stringify(body) : undefined });
  const A = () => auth.h.admin;
  const tdsFields = [{ name: 'companyName', value: 'Acme' }, { name: 'duration', value: '{"quarter":1,"year":2026}' }, { name: 'tanNumber', value: 'TAN1' }, { name: 'panNumber', value: 'PAN1' }, { name: 'accountNumber', value: '123' }, { name: 'ifsc', value: 'IFSC0001' }, { name: 'accountHolderName', value: 'Acme' }, { name: 'tdsAmount', value: '500' }];
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['templates list', () => j('GET', '/api/templates', A())],
    ['templates list provider', () => j('GET', '/api/templates?provider=ajio', A())],
    ['templates upsert new', () => j('POST', '/api/templates', A(), { name: 'New', subject: 'S', body: 'B {{awb}}', provider: 'myntra' }), creates],
    ['templates upsert invalid (no body)', () => j('POST', '/api/templates', A(), { name: 'X' })],
    ['templates deactivate', () => j('POST', `/api/templates/${tpl1}/deactivate`, A()), upd],
    ['templates delete', () => j('DELETE', `/api/templates/${tpl1}`, A())],
    ['templates delete invalid id (no try/catch → hangs?)', () => j('DELETE', '/api/templates/zzz', A())],
    ['templates default', () => j('GET', '/api/templates/default?provider=ajio', A())],
    ['templates set default', () => j('POST', `/api/templates/${tpl1}/default`, A()), upd],
    ['templates set default unknown', () => j('POST', `/api/templates/${new mongoose.Types.ObjectId()}/default`, A())],
    ['templates preview', () => j('GET', `/api/templates/${tpl1}/preview`, A())],
    ['templates build-default', () => j('POST', '/api/templates/build-default', A(), { provider: 'ajio' }), creates],
    ['templates no perm custom role → 403', () => j('GET', '/api/templates', auth.h.noPerm)],
    ['tds create (file → S3 stub)', () => ({ method: 'POST', path: '/api/tds/create', ...multipart([...tdsFields, { name: 'file', filename: 'cert.pdf', type: 'application/pdf', data: Buffer.from('%PDF-1.4') }]), headers: { ...multipart([]).headers, ...A() } }), creates],
    ['tds create validation error', () => ({ method: 'POST', path: '/api/tds/create', ...multipart([{ name: 'companyName', value: 'Acme' }]) , headers: { ...multipart([]).headers, ...A() } })],
    ['tds create no file', () => ({ method: 'POST', path: '/api/tds/create', ...multipart(tdsFields), headers: { ...multipart([]).headers, ...A() } })],
    ['tds list', () => j('POST', '/api/tds', A(), { page: 1, limit: 10 })],
    ['tds super_admin list', () => j('POST', '/api/tds/super_admin', auth.h.sys, { page: 1, limit: 10 })],
    ['tds super_admin as user → 401', () => j('POST', '/api/tds/super_admin', A(), {})],
    ['tds close request', () => j('PUT', '/api/tds/close-tds-request', auth.h.sys, { id: String(tds1) }), upd],
    ['tds update super_admin (no file)', () => ({ method: 'POST', path: '/api/tds/update/super_admin', ...multipart([{ name: 'id', value: String(tds1) }, { name: 'tdsRefundedAmount', value: '50' }, { name: 'companyId', value: String(auth.companyId) }]), headers: { ...multipart([]).headers, ...auth.h.sys } }), { volatile: ['updatedAt', 'refundedAt'] }],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) { const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++; process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 150), i + 100)}\nN: ${b.slice(Math.max(0, i - 150), i + 100)}\n`); }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('success paths are exercised; S3 was only ever stubbed', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
    expect(Object.values(statuses).filter((s) => s === 200 || s === 201).length).toBeGreaterThanOrEqual(10);
    expect(uploads.length).toBeGreaterThanOrEqual(2); // tds create on both sides
  });
});
