import mongoose from 'mongoose';
import http from 'http';
import { Module } from '@nestjs/common';
import filesRouter from '@legacy/routes/Files/files.routes';
import { ImportsRouter } from '@legacy/routes/Imports/imports.routes';
import webhookRouter from '@legacy/routes/Webhook/webhook.routes';
import { S3Service } from '@legacy/utils/s3';
import { Queue } from 'bullmq';
import Company from '@legacy/models/Company/company.model';
import { FilesModule } from '../../src/modules/files/files.module';
import { ImportsModule } from '../../src/modules/imports/imports.module';
import { WebhookModule } from '../../src/modules/webhook/webhook.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

@Module({ imports: [FilesModule, ImportsModule, WebhookModule] })
class M {}

describe('Files / Imports / Webhook parity', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const deleted: string[] = [];
  const at = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    // S3 stubs: objects whose key starts with "missing" do not exist
    spies.push(jest.spyOn(S3Service.prototype as any, 'getObject').mockImplementation((async (key: any) => {
      if (String(key).startsWith('missing')) { const e: any = new Error('NoSuchKey'); e.code = 'NoSuchKey'; e.statusCode = 404; throw e; }
      return { ContentType: 'video/mp4', ContentLength: 4, ETag: '"abc"', Body: Buffer.from('MP4!') };
    }) as any));
    spies.push(jest.spyOn(S3Service.prototype as any, 'deleteObject').mockImplementation((async (key: any) => { deleted.push(String(key)); return {}; }) as any));
    spies.push(jest.spyOn(Queue.prototype, 'add').mockImplementation((async () => ({ id: 'job' })) as any));
    auth = seedAuth();
    auth.grant('external_imports::view');
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    p = await startPair([['/api/files', filesRouter], ['/api/external-imports', ImportsRouter], ['/api/webhooks', webhookRouter]], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object = {}, body?: object): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body ? JSON.stringify(body) : undefined });
  const A = () => auth.h.admin;
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['files GET nested key', () => j('GET', '/api/files/videos/2026/a.mp4')],
    ['files GET encoded key (%2F, space)', () => j('GET', '/api/files/videos%2Fx%20y.mp4')],
    ['files GET missing (legacy error page embeds the stack)', () => j('GET', '/api/files/missing/a.mp4'), { bodyMasks: [/<code>[\s\S]*?<\/code>/] }],
    ['files GET prefix only (key "")', () => j('GET', '/api/files')],
    ['files GET trailing slash (key "")', () => j('GET', '/api/files/')],
    ['files GET bad encoding → 400 URIError page', () => j('GET', '/api/files/a%ZZ'), { bodyMasks: [/(&lt;anonymous&gt;\)|&#39;)<br>[\s\S]*?<\/pre>/] }],
    ['files GET uppercase prefix', () => j('GET', '/API/FILES/videos/a.mp4')],
    ['files get-file-link', () => j('GET', '/api/files/get-file-link/videos/a.mp4')],
    ['files get-file-link (no slash → getFile key "get-file-link")', () => j('GET', '/api/files/get-file-link')],
    ['files get-file-link/ (slash → link, key "")', () => j('GET', '/api/files/get-file-link/')],
    ['files bad escape in a static segment → 404 page', () => j('GET', '/api/external-imports/im%ZZport')],
    ['files bad escape in get-file-link key', () => j('GET', '/api/files/get-file-link/a%ZZ'), { bodyMasks: [/(&lt;anonymous&gt;\)|&#39;)<br>[\s\S]*?<\/pre>/] }],
    ['files get-drive-link', () => j('GET', '/api/files/get-drive-link/videos/a.mp4')],
    ['files DELETE key', () => j('DELETE', '/api/files/videos/a.mp4', A())],
    ['files retry-cloud-processing no perm', () => j('POST', '/api/files/retry-cloud-processing', auth.h.noPerm, {})],
    ['files retry-cloud-processing', () => j('POST', '/api/files/retry-cloud-processing', A(), { fileId: String(new mongoose.Types.ObjectId()) })],
    ['imports list', () => j('GET', '/api/external-imports/import', A())],
    ['imports excel', () => j('GET', '/api/external-imports/excel', A()), { creates: true, headerMasks: { 'content-disposition': /\d{13}/ } }],
    ['imports delete-import', () => j('POST', '/api/external-imports/delete-import', A(), { ids: [] })],
    ['imports import without file', () => j('POST', '/api/external-imports/import', A(), {})],
    ['imports no token', () => j('GET', '/api/external-imports/import')],
    ['webhooks outlook validation token', () => j('POST', '/api/webhooks/outlook?validationToken=abc%20123')],
    ['webhooks outlook notification (empty)', () => j('POST', '/api/webhooks/outlook', {}, { value: [] })],
    ['webhooks provider empty', () => j('POST', '/api/webhooks/provider', {}, {})],
    ['webhooks register empty', () => j('POST', '/api/webhooks/register', {}, {})],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) { const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++; process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 150), i + 100)}\nN: ${b.slice(Math.max(0, i - 150), i + 100)}\n`); }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('import-status SSE: same headers and first event (unknown job, shared Redis)', async () => {
    const open = (port: number) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; first: string }>((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/external-imports/import-status/no-such-job-xyz' }, (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c; const i = buf.indexOf('\n\n'); if (i >= 0) { resolve({ status: res.statusCode, headers: res.headers, first: buf.slice(0, i) }); req.destroy(); } });
      });
    });
    const a = await open(p.legacyPort);
    const b = await open(p.newPort);
    const h = (x: any) => ['content-type', 'cache-control', 'connection', 'access-control-allow-origin'].map((k) => x.headers[k]);
    expect([b.status, h(b), b.first]).toEqual([a.status, h(a), a.first]);
    expect(a.first).toBe('data: {"status":"Job not found"}');
  });

  it('success paths are exercised', () => {
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
    expect(statuses['files GET nested key']).toBe(200);
    expect(statuses['files GET bad encoding → 400 URIError page']).toBe(400);
    expect(Object.values(statuses).filter((s) => s >= 200 && s < 300).length).toBeGreaterThanOrEqual(10);
  });
});
