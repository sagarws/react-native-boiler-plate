import fs from 'fs';
import path from 'path';
import type { ContractCase } from '../harness';

/**
 * Every endpoint marked [x] for the main server in PROGRESS.txt, against BOTH live servers.
 * GET: as anon / admin / custom-role user / system admin. Other methods: anon only (auth-protected
 * writes stop at the auth layer; public ones hit the local DB). Tokens: test/contract/.tokens.json
 * (scripts/seed-local.js). Path params get one fixed ObjectId.
 */
const BE = path.resolve(__dirname, '..', '..', '..');
const tokens = JSON.parse(fs.readFileSync(path.join(BE, 'test/contract/.tokens.json'), 'utf8'));
const FIXED_ID = '6a0000000000000000000001';
const VOLATILE = ['_id', 'id', 'createdAt', 'updatedAt', '__v', 'token', 'accessToken', 'expiresAt', 'requestedAt', 'date', 'ranAt', 'now', 'generatedAt', 'timestamp', 'url', 'state'];

const routes = fs.readFileSync(path.join(BE, 'PROGRESS.txt'), 'utf8').split('\n')
  .map((l) => /^\[x\] \[main\] ([A-Z]+)\s+(\S+)$/.exec(l)).filter(Boolean)
  .map(([, method, p]) => ({ method, path: p.replace(/:(\w+)\(\*\)/g, 'a/b.mp4').replace(/:(\w+)/g, FIXED_ID) }));

const who: Record<string, Record<string, string>> = {
  anon: {},
  admin: { authorization: `Bearer ${tokens.admin}` },
  viewer: { authorization: `Bearer ${tokens.viewer}` },
  sysadmin: { authorization: `Bearer ${tokens.sys}` },
};

const cases: ContractCase[] = [];
for (const r of routes) {
  const ids = r.method === 'GET' ? Object.keys(who) : ['anon'];
  for (const k of ids) {
    cases.push({
      name: `${r.method} ${r.path} as ${k}`,
      method: r.method as ContractCase['method'],
      path: r.path,
      headers: who[k],
      body: r.method === 'GET' || r.method === 'DELETE' ? undefined : {},
      maskKeys: VOLATILE,
      timeoutMs: 4000,
    });
  }
}
export default cases;
