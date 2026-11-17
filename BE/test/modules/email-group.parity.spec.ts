import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import emailRouter from '@legacy/routes/Email/email.routes';
import mailboxRouter from '@legacy/routes/Mailbox/mailbox.routes';
import passwordMailboxRouter from '@legacy/routes/Mailbox/passwordMailbox.routes';
import whatsappRouter from '@legacy/routes/WhatsApp/whatsapp.routes';
import supportChatRouter from '@legacy/routes/SupportChat/supportChat.routes';
import googleDriveRouter from '@legacy/routes/GoogleDrive/googleDrive.routes';
import ecomRouter from '@legacy/routes/EasyEcom/easy-ecom.routes';
import Company from '@legacy/models/Company/company.model';
import { EmailModule } from '../../src/modules/email/email.module';
import { MailboxModule } from '../../src/modules/mailbox/mailbox.module';
import { WhatsAppModule } from '../../src/modules/whatsapp/whatsapp.module';
import { SupportChatModule } from '../../src/modules/support-chat/support-chat.module';
import { GoogleDriveModule } from '../../src/modules/google-drive/google-drive.module';
import { EasyEcomModule } from '../../src/modules/easy-ecom/easy-ecom.module';
import { startPair } from '../support/legacy-app';
import { memoryDb } from '../support/memory-db';
import { seedAuth } from '../support/auth-fixtures';
import { routesOf, smokeCases, runParity } from '../support/route-smoke';

process.env.EASY_ECOM_TOKEN = 'easy-token';

@Module({ imports: [EmailModule, MailboxModule, WhatsAppModule, SupportChatModule, GoogleDriveModule, EasyEcomModule] })
class M {}

const ROUTES = [
  ...routesOf('src/modules/email/email.controller.ts', '/api/emails'),
  ...routesOf('src/modules/mailbox/mailbox.controller.ts', '/api/mailboxes'),
  ...routesOf('src/modules/mailbox/password-mailbox.controller.ts', '/api/mailbox/password'),
  ...routesOf('src/modules/whatsapp/whatsapp.controller.ts', '/api/whatsapp'),
  ...routesOf('src/modules/support-chat/support-chat.controller.ts', '/api/support-chat'),
  ...routesOf('src/modules/google-drive/google-drive.controller.ts', '/api/drive'),
  ...routesOf('src/modules/easy-ecom/easy-ecom.controller.ts', '/api/easy-ecom'),
];

describe('Email group route-smoke parity (every route × identity)', () => {
  let p: Awaited<ReturnType<typeof startPair>>;
  let auth: ReturnType<typeof seedAuth>;
  let initial: Map<string, any[]>;
  let spies: jest.SpyInstance[];
  const statuses: Record<string, number> = {};
  const at = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    spies = ['error', 'log', 'warn', 'info', 'debug'].map((m) => jest.spyOn(console, m as any).mockImplementation(() => undefined));
    spies.push(jest.spyOn(Queue.prototype, 'add').mockImplementation((async () => ({ id: 'job' })) as any));
    auth = seedAuth();
    memoryDb.useAll();
    memoryDb.seed(Company, [{ _id: auth.companyId, name: 'Acme', email: 'a@x.io', createdAt: at, updatedAt: at }]);
    p = await startPair([
      ['/api/emails', emailRouter], ['/api/mailboxes', mailboxRouter], ['/api/mailbox/password', passwordMailboxRouter],
      ['/api/whatsapp', whatsappRouter], ['/api/support-chat', supportChatRouter], ['/api/drive', googleDriveRouter], ['/api/easy-ecom', ecomRouter],
    ], M);
    initial = memoryDb.snapshot();
  });
  beforeEach(() => memoryDb.restore(initial));
  afterAll(async () => { spies.forEach((s) => s.mockRestore()); await p.close(); memoryDb.uninstall(); });

  const CASES = smokeCases(ROUTES, { anon: {}, admin: auth_h('admin'), sysadmin: auth_h('sys'), easy: { authorization: 'Bearer easy-token' } });
  function auth_h(k: 'admin' | 'sys') { return { get authorization() { return k === 'admin' ? `Bearer ${auth.tokens.admin}` : `Bearer ${auth.tokens.sys}`; } } as any; }

  it('covers every generated route', () => expect(ROUTES.length).toBe(19 + 23 + 4 + 16 + 26 + 4 + 1));

  it.each(CASES)('%s', async (name, mk, opts) => {
    const req = mk();
    req.headers = { ...req.headers, ...(req.headers.authorization ? { authorization: String(req.headers.authorization) } : {}) };
    const r = await runParity(p, req, opts);
    statuses[name] = r.raw.a.status;
    if (process.env.DIFF && r.legacy.body !== r.next.body) { const a = r.legacy.body, b = r.next.body; let i = 0; while (a[i] === b[i]) i++; process.stdout.write(`\nDIFF ${name} @${i}\nL: ${a.slice(Math.max(0, i - 150), i + 100)}\nN: ${b.slice(Math.max(0, i - 150), i + 100)}\n`); }
    expect(JSON.stringify(r.next, null, 1)).toBe(JSON.stringify(r.legacy, null, 1));
    expect(JSON.stringify(r.nextDb, null, 1)).toBe(JSON.stringify(r.legacyDb, null, 1));
  });

  it('status mix: not everything is the same error', () => {
    const counts: Record<string, number> = {};
    Object.values(statuses).forEach((s) => (counts[s] = (counts[s] || 0) + 1));
    if (process.env.SHOW) process.stdout.write(JSON.stringify(counts) + '\n');
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(4);
    expect((counts['200'] || 0) + (counts['201'] || 0)).toBeGreaterThanOrEqual(20);
  });
});
