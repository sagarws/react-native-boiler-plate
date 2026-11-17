import http from 'http';
import path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Queue } from 'bullmq';
import { fileUploader } from '@legacy/middleware/fileuploader.middleware';
import authMiddleware from '@legacy/middleware/authentication.middleware';
import adminAuth from '@legacy/middleware/adminAuth.middleware';
import { MasterImportOrderReports, OrderDataImport, UpdateMasterImportOrderReports } from '@legacy/controllers/MasterImport/masterImportOrderReports.controller';
import { WhatsappDataImport, downloadWhatsAppSample, retryAllD2CWhatsAppMessages } from '@legacy/controllers/WhatsappDataImport/whatsappDataImport.controller';
import { importData } from '@legacy/controllers/Imports/imports.controller';
import { addProductSkucodeMap } from '@legacy/controllers/ProductSkucodeMap/productSkucodeMap.controller';
import { MasterImportOrderReportsV2, UpdateMasterImportOrderReportsV2, OrderDataImportV2, ScanReturnParcelV2, CheckMultipleSkuOrQtyV2, UpdateReturnQuantitiesV2 } from '@legacy/v2/masterImport/controllers/import.controller';
import { MeeshoMasterImportV2 } from '@legacy/v2/masterImport/controllers/meeshoImport.controller';
import { SnapdealMasterImportV2 } from '@legacy/v2/masterImport/controllers/snapdealImport.controller';
import { MyntraMasterImportV2, MyntraScanVideoImportV2 } from '@legacy/v2/masterImport/controllers/myntraImport.controller';
import { S3Service } from '@legacy/utils/s3';
import Company from '@legacy/models/Company/company.model';
import { createMasterImportServerApp } from '../../src/master-import-server/bootstrap';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { smokeCases, runParity } from '../support/route-smoke';
// legacy-style logging of async handler rejections in Express 4 (see test/support/legacy-app.ts)
import '../support/legacy-app';

/** The routes of legacy MasterImportServer.ts, copied as declared there (minus bull-board, workers). */
const buildLegacyMis = () => {
  const app = express();
  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(express.static(path.join('public')));
  app.set('view engine', 'ejs');
  const dropship = fileUploader.fields([{ name: 'DropshipOrderFile', maxCount: 1 }, { name: 'DropshipRtvFile', maxCount: 1 }, { name: 'DropshipFile', maxCount: 1 }]);
  app.get('/', (req, res) => { res.send('Hello World!, this is the Master Server!'); });
  app.post('/api/master/masterImportOrderReports', authMiddleware as any, dropship, MasterImportOrderReports as any);
  app.post('/api/master/updateMasterImportOrderReports', authMiddleware as any, fileUploader.single('UpdateRtv'), UpdateMasterImportOrderReports as any);
  app.get('/health', (req, res) => { res.send('Hello Home'); });
  app.post('/api/master/orderDataImport', authMiddleware as any, fileUploader.fields([{ name: 'OrderDataFile', maxCount: 1 }]), OrderDataImport as any);
  app.post('/api/master/whatsappNumberImport', authMiddleware as any, fileUploader.fields([{ name: 'WhatsAppNumberFile', maxCount: 1 }]), WhatsappDataImport as any);
  app.get('/api/master/whatsappNumberSample', authMiddleware as any, downloadWhatsAppSample as any);
  app.post('/api/d2c/whatsapp/retry-all', authMiddleware as any, retryAllD2CWhatsAppMessages as any);
  app.post('/api/v2/master/import', authMiddleware as any, dropship, MasterImportOrderReportsV2 as any);
  app.post('/api/v2/meesho-master/import', authMiddleware as any, fileUploader.single('file'), MeeshoMasterImportV2 as any);
  app.post('/api/v2/snapdeal-master/import', authMiddleware as any, fileUploader.single('file'), SnapdealMasterImportV2 as any);
  app.post('/api/v2/myntra-master/import', authMiddleware as any, fileUploader.single('file'), MyntraMasterImportV2 as any);
  app.post('/api/v2/myntra-master/scan-video-import', authMiddleware as any, fileUploader.single('file'), MyntraScanVideoImportV2 as any);
  app.post('/api/v2/master/import/update-rtv', authMiddleware as any, fileUploader.single('UpdateRtv'), UpdateMasterImportOrderReportsV2 as any);
  app.post('/api/v2/master/import/order-data', authMiddleware as any, fileUploader.fields([{ name: 'OrderDataFile', maxCount: 1 }]), OrderDataImportV2 as any);
  app.post('/api/v2/master/scan-return-parcel', authMiddleware as any, ScanReturnParcelV2 as any);
  app.post('/api/v2/master/checkMultipleSkuOrQty', authMiddleware as any, CheckMultipleSkuOrQtyV2 as any);
  app.post('/api/v2/master/updateReturnQuantities', authMiddleware as any, UpdateReturnQuantitiesV2 as any);
  app.post('/api/external-imports/import', adminAuth(['external_imports::edit']) as any, fileUploader.single('file'), importData as any);
  app.post('/api/product-skucode-map', authMiddleware as any, fileUploader.fields([{ name: 'ProductSkucodeFile', maxCount: 1 }]), addProductSkucodeMap as any);
  return app;
};

const ROUTES = require('fs').readFileSync(path.resolve(__dirname, '../../PROGRESS.txt'), 'utf8').split('\n')
  .map((l: string) => /^\[[ x]\] \[master-import-server\] ([A-Z]+)\s+(\S+)$/.exec(l)).filter(Boolean)
  .map(([, method, p]: string[]) => ({ method, path: p }));

describe('MasterImportServer parity (HTTP; workers excluded in tests)', () => {
  let ports: { legacyPort: number; newPort: number };
  let legacy: http.Server;
  let nest: any;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const at = new Date('2026-01-01T00:00:00.000Z');

  const onRejection = (reason: unknown) => console.error('[UNHANDLED REJECTION]', reason);
  beforeAll(async () => {
    process.on('unhandledRejection', onRejection);
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    spies.push(jest.spyOn(Queue.prototype, 'add').mockImplementation((async () => ({ id: 'job' })) as any));
    for (const m of ['uploadObject', 'uploadBuffer', 'deleteObject', 'getObject', 'headObject']) spies.push(jest.spyOn(S3Service.prototype as any, m).mockImplementation((async () => ({})) as any));
    auth = seedAuth();
    auth.grant('external_imports::edit');
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    legacy = http.createServer(buildLegacyMis());
    const lp = await new Promise<number>((r) => legacy.listen(0, '127.0.0.1', () => r((legacy.address() as any).port)));
    nest = await createMasterImportServerApp();
    await nest.listen(0, '127.0.0.1');
    ports = { legacyPort: lp, newPort: nest.getHttpServer().address().port };
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => {
    spies.forEach((s) => s.mockRestore());
    nest.getHttpServer().closeAllConnections?.(); legacy.closeAllConnections();
    await nest.close(); await new Promise((r) => legacy.close(r)); memoryDb.uninstall();
    process.off('unhandledRejection', onRejection);
  });

  it('covers all 20 MasterImportServer endpoints', () => expect(ROUTES.length).toBe(20));

  const tok = { get authorization() { return `Bearer ${auth.tokens.admin}`; } } as any;
  it.each(smokeCases(ROUTES, { anon: {}, admin: tok }))('%s', async (_n, mk, opts) => {
    const req = mk();
    if (req.headers.authorization) req.headers = { ...req.headers, authorization: String(req.headers.authorization) };
    const r = await runParity(ports, req, opts);
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('JSON bodies are NOT parsed (legacy has no express.json()), form bodies are', async () => {
    const json = { method: 'POST', path: '/api/v2/master/scan-return-parcel', headers: { authorization: `Bearer ${auth.tokens.admin}`, 'content-type': 'application/json' }, body: '{"awb":"X1"}' };
    const form = { ...json, headers: { ...json.headers, 'content-type': 'application/x-www-form-urlencoded' }, body: 'awb=X1' };
    for (const r of [json, form]) {
      const p = await runParity(ports, r);
      expect(p.next).toEqual(p.legacy);
    }
  });
});
