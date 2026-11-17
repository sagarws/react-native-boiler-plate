// Legacy modules build Redis connections at import with `port: +process.env.REDIS_PORT`
// (NaN when unset). Tests use the local Redis on loopback.
process.env.REDIS_PORT = process.env.REDIS_PORT || '6379';
process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
/**
 * Global test safety net (runs before every test file):
 * - nodemailer: legacy utils/mail.ts opens an SMTP connection at import (`transporter.verify`).
 *   Tests get a fake transport, so no test can reach a mail server or send real email.
 *   Sent messages are recorded on `globalThis.__sentMail` for assertions.
 */
(globalThis as any).__sentMail = [];
jest.mock('nodemailer', () => {
  const actual = jest.requireActual('nodemailer');
  return {
    ...actual,
    createTransport: () => ({
      verify: (cb?: (e: unknown, ok: boolean) => void) => (cb ? cb(null, true) : Promise.resolve(true)),
      sendMail: (msg: unknown, cb?: (e: unknown, info: unknown) => void) => {
        (globalThis as any).__sentMail.push(msg);
        const info = { messageId: 'test', accepted: [] };
        return cb ? cb(null, info) : Promise.resolve(info);
      },
      close: () => undefined,
      use: () => undefined,
    }),
  };
});

/**
 * - Network: only loopback connections are allowed in tests. Legacy handlers call marketplaces,
 *   GitHub, Meta, S3, … — any such attempt fails fast with ECONNREFUSED-like error instead.
 * - puppeteer: launching a browser is refused (legacy verifies marketplace logins with it).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const net = require('net');
const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost|::ffff:127\.0\.0\.1)$/;
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(this: any, ...args: any[]) {
  const opts = typeof args[0] === 'object' && args[0] !== null ? args[0] : { port: args[0], host: typeof args[1] === 'string' ? args[1] : undefined };
  const host = opts.host ?? (opts.path ? 'localhost' : 'localhost');
  if (!opts.path && !LOOPBACK.test(String(host))) {
    const err: any = new Error(`test network guard: blocked connection to ${host}:${opts.port}`);
    err.code = 'ECONNREFUSED';
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return origConnect.apply(this, args);
};
jest.mock('puppeteer', () => {
  const actual = jest.requireActual('puppeteer');
  const launch = () => Promise.reject(new Error('test guard: puppeteer.launch is disabled in tests'));
  return { ...actual, launch, default: { ...(actual.default || actual), launch } };
});

/**
 * Legacy modules open long-lived Redis connections at import (ioredis + BullMQ queues). Record
 * every ioredis client so test/support/jest-teardown.ts can close them after each test file.
 */
jest.mock('ioredis', () => {
  const Actual = jest.requireActual('ioredis');
  const Base = Actual.default ?? Actual;
  const clients: any[] = ((globalThis as any).__redisClients = (globalThis as any).__redisClients || []);
  class TrackedRedis extends Base {
    constructor(...args: any[]) {
      super(...args);
      clients.push(this);
    }
  }
  // static members (Cluster, Command, …) are inherited through `extends`; export shape like ioredis
  const mod: any = TrackedRedis;
  for (const k of ['default', 'Redis']) Object.defineProperty(mod, k, { value: TrackedRedis, configurable: true });
  return mod;
});
