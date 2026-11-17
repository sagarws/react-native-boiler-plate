import fs from 'fs';
import mongoose from 'mongoose';
import { runParity, ParityOpts } from './module-parity';
import type { Req } from './parity';

export interface SmokeRoute { method: string; path: string }

/** Routes of a generated controller (from its `legacy line N: METHOD /path` comments). */
export const routesOf = (controllerFile: string, prefix: string): SmokeRoute[] =>
  [...fs.readFileSync(controllerFile, 'utf8').matchAll(/legacy line \d+: ([A-Z]+) (\S*) ?\*\//g)]
    .map(([, method, p]) => ({ method, path: (prefix + (p === '/' || p === '' ? '' : p)).replace(/\/+/g, '/') }));

const fill = (p: string) => p.replace(/:(\w+)/g, () => String(new mongoose.Types.ObjectId()));

/**
 * One parity case per route × identity. Bodies are `{}` (JSON). Params get fresh ObjectIds
 * (identical on both sides). Responses AND DB state must match; hangs must happen on both sides.
 */
export const smokeCases = (routes: SmokeRoute[], identities: Record<string, Record<string, string>>): [string, () => Req, ParityOpts][] => {
  const cases: [string, () => Req, ParityOpts][] = [];
  for (const r of routes) {
    for (const [who, headers] of Object.entries(identities)) {
      let url: string | null = null;
      cases.push([`${r.method} ${r.path} as ${who}`, () => {
        url = url || fill(r.path); // same URL for both sides of the pair
        return { method: r.method, path: url, headers: { ...headers, 'content-type': 'application/json' }, body: r.method === 'GET' || r.method === 'DELETE' ? undefined : '{}' };
      }, { creates: true, volatile: ['token', 'expiresAt', 'state', 'url', 'authUrl', 'redirectUrl', 'code', 'otp', 'inviteToken', 'requestedAt', 'date', 'now', 'generatedAt', 'timestamp'], bodyMasks: [/<pre>[\s\S]*?<\/pre>/] }]);
    }
  }
  return cases;
};

export { runParity };
