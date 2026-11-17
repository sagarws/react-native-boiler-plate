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
