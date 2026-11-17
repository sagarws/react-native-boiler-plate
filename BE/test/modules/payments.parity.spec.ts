import crypto from 'crypto';
import mongoose from 'mongoose';
import { Module } from '@nestjs/common';
import { ManualPaymentRouter } from '@legacy/routes/manualPayment/manualPayment.routes';
import razorpayRouter from '@legacy/routes/razorpay/razorpay.router';
import Company from '@legacy/models/Company/company.model';
import { ManualPaymentModule } from '../../src/modules/manual-payment/manual-payment.module';
import { RazorpayModule } from '../../src/modules/razorpay/razorpay.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { runParity, ParityOpts } from '../support/module-parity';
import { Req } from '../support/parity';

process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
process.env.RAZORPAY_KEY_SECRET = 'key_secret_test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';

@Module({ imports: [ManualPaymentModule, RazorpayModule] })
class M {}

describe('manualPayment + razorpay parity (webhook signatures over parsed body)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');
  const creates: ParityOpts = { creates: true };

  beforeAll(async () => {
    spies = (process.env.LOGS ? ['info'] : ['error', 'log', 'warn', 'info']).map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    auth = seedAuth();
    auth.grant('accounts::purchase_history::view');
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    p = await startPair([['/api/manual-payment', ManualPaymentRouter], ['/api/razorpay', razorpayRouter]], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const j = (method: string, path: string, h: object, body?: object | string): Req => ({ method, path, headers: { ...h, 'content-type': 'application/json' } as any, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  /** Razorpay signs the raw bytes it sends; legacy verifies HMAC(JSON.stringify(parsed)). Pretty JSON makes them differ. */
  const webhook = (path: string, event: object, { pretty = false, secret = process.env.RAZORPAY_WEBHOOK_SECRET } = {}): Req => {
    const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(event)).digest('hex');
    return j('POST', path, { 'x-razorpay-signature': signature }, pretty ? JSON.stringify(event, null, 2) : JSON.stringify(event));
  };
  /** Shaped like a real Razorpay webhook (all fields the Payment schema requires). */
  const pay = (ev: string) => ({
    entity: 'event', account_id: 'acc_test', event: ev, contains: ['payment'], created_at: 1763380000,
    payload: { payment: { entity: {
      id: 'pay_1', entity: 'payment', amount: 50000, currency: 'INR', status: ev.split('.')[1], order_id: 'order_1',
      method: 'upi', amount_refunded: 0, captured: ev === 'payment.captured', international: false,
      email: 'a@x.io', contact: '+919000000000', notes: [], created_at: 1763380000,
    } } },
  });
  const A = () => auth.h.admin;
  const CASES: [string, () => Req, ParityOpts?][] = [
    ['razorpay hello', () => j('GET', '/api/razorpay', {})],
    ['payment-event authorized (valid sig)', () => webhook('/api/razorpay/payment-event', pay('payment.authorized')), creates],
    ['payment-event authorized, pretty-printed body (sig over parsed JSON)', () => webhook('/api/razorpay/payment-event', pay('payment.authorized'), { pretty: true }), creates],
    ['payment-event captured', () => webhook('/api/razorpay/payment-event', pay('payment.captured')), creates],
    ['payment-event failed', () => webhook('/api/razorpay/payment-event', pay('payment.failed')), creates],
    ['payment-event bad signature', () => webhook('/api/razorpay/payment-event', pay('payment.authorized'), { secret: 'wrong' })],
    ['payment-event no payload (destructure outside try → hang)', () => j('POST', '/api/razorpay/payment-event', { 'x-razorpay-signature': 'x' }, { event: 'x' })],
    ['order-event bad signature', () => webhook('/api/razorpay/order-event', { event: 'order.paid', payload: { order: { entity: { id: 'order_1' } }, payment: { entity: { id: 'pay_1' } } } }, { secret: 'wrong' })],
    ['verify-signature bad', () => j('POST', '/api/razorpay/verify-signature', { 'x-razorpay-signature': 'nope' }, { a: 1 })],
    ['verify-signature good', () => j('POST', '/api/razorpay/verify-signature', { 'x-razorpay-signature': crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(JSON.stringify({ a: 1 })).digest('hex') }, { a: 1 })],
    ['verify-payment bad sig', () => j('POST', '/api/razorpay/verify-payment', A(), { razorpay_order_id: 'o', razorpay_payment_id: 'p', razorpay_signature: 'bad' })],
    ['payment-status', () => j('POST', '/api/razorpay/payment-status', {}, {})],
    ['payment-history', () => j('POST', '/api/razorpay/payment-history', A(), { page: 1, limit: 10 })],
    ['manual all (sysadmin)', () => j('GET', '/api/manual-payment/all', auth.h.sys)],
    ['manual pending-count', () => j('GET', '/api/manual-payment/pending-count', auth.h.sys)],
    ['manual all as user → 401', () => j('GET', '/api/manual-payment/all', A())],
    ['manual status unknown id', () => j('GET', `/api/manual-payment/status?id=${new mongoose.Types.ObjectId()}&status=approved`, auth.h.sys)],
    ['manual invoice unknown', () => j('GET', `/api/manual-payment/invoice?id=${new mongoose.Types.ObjectId()}`, A())],
    ['manual excel (xlsx download)', () => j('GET', '/api/manual-payment/excel', A()), { headerMasks: { 'content-disposition': /\d{13}/ } }],
    ['razorpay place-order (adminAuth factory → hang)', () => j('POST', '/api/razorpay/place-order', A(), { amount: 100 })],
    ['manual all/export (xlsx)', () => j('GET', '/api/manual-payment/all/export', auth.h.sys), { headerMasks: { 'content-disposition': /\d{13}/ } }],
    ['manual system-admin invoice unknown', () => j('GET', `/api/manual-payment/system-admin/invoice?id=${new mongoose.Types.ObjectId()}`, auth.h.sys)],
    ['manual create without file', () => j('POST', '/api/manual-payment', A(), { amount: 100 })],
  ];

  it.each(CASES)('%s', async (name, mk, opts = {}) => {
    const r = await runParity(p, mk(), opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) { const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++; process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 150), i + 100)}\nN: ${b.slice(Math.max(0, i - 150), i + 100)}\n`); }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('signed webhooks are accepted on the new server (not only rejected alike)', () => {
    expect(statuses['payment-event authorized (valid sig)']).toBe(200);
    expect(statuses['payment-event authorized, pretty-printed body (sig over parsed JSON)']).toBe(200);
    // legacy verifyRazorpaySignature has an empty `else` → a VALID signature never gets a response
    expect(statuses['verify-signature good']).toBe(-1);
    expect(statuses['razorpay place-order (adminAuth factory → hang)']).toBe(-1);
    if (process.env.SHOW) process.stdout.write(JSON.stringify(statuses, null, 1) + '\n');
  });
});
