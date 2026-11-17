import { Queue } from 'bullmq';
import masterRouter from '@legacy/routes/MasterImport/MasterImport.routes';
import Company from '@legacy/models/Company/company.model';
import { S3Service } from '@legacy/utils/s3';
import { MasterImportModule } from '../../src/modules/master-import/master-import.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { routesOf, smokeCases, runParity } from '../support/route-smoke';

const ROUTES = routesOf('src/modules/master-import/master-import.controller.ts', '/api/master');

describe('MasterImport route-smoke parity (/api/master) — worker shimmed on both sides', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    spies.push(jest.spyOn(Queue.prototype, 'add').mockImplementation((async () => ({ id: 'job' })) as any));
    for (const m of ['uploadObject', 'uploadBuffer', 'deleteObject', 'getObject', 'headObject']) spies.push(jest.spyOn(S3Service.prototype as any, m).mockImplementation((async () => ({})) as any));
    auth = seedAuth();
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    p = await startPair([['/api/master', masterRouter]], MasterImportModule);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const tok = (k: 'admin' | 'sys') => ({ get authorization() { return `Bearer ${k === 'admin' ? auth.tokens.admin : auth.tokens.sys}`; } }) as any;
  const CASES = smokeCases(ROUTES, { anon: {}, admin: tok('admin'), sysadmin: tok('sys') });

  it('covers every route', () => expect(ROUTES.length).toBe(25));

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
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(3);
  });
});
