import fs from 'fs';
import path from 'path';
import { assertWritesAllowed, call, ContractCase, normalize } from './harness';

/**
 * Runs every `cases/<module>.cases.ts` (export default ContractCase[]) against both servers.
 *   LEGACY_URL=http://localhost:8000 NEW_URL=http://localhost:8100 CONTRACT_DB=dev npm run test:contract
 *   CONTRACT_MODULE=Common npm run test:contract   (one module)
 * Tokens for the cases come from env (CONTRACT_TOKEN_USER, CONTRACT_TOKEN_ADMIN, CONTRACT_TOKEN_SYSADMIN, ...).
 */
const LEGACY = process.env.LEGACY_URL || 'http://localhost:8000';
const NEW = process.env.NEW_URL || 'http://localhost:8100';
const only = process.env.CONTRACT_MODULE;
const dir = path.join(__dirname, 'cases');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cases.ts') && (!only || f.startsWith(`${only}.`)));

for (const f of files) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cases: ContractCase[] = require(path.join(dir, f)).default;
  describe(f.replace('.cases.ts', ''), () => {
    it.each(cases.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
      assertWritesAllowed(c);
      const a = await call(LEGACY, c);
      const b = await call(NEW, c);
      expect(normalize(b, c)).toEqual(normalize(a, c));
    });
  });
}
