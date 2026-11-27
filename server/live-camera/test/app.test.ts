import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { issueViewerToken, readViewerToken } from '../src/crypto.ts';
import type { MediaMtx } from '../src/mediamtx.ts';
import { RateLimiter } from '../src/rateLimit.ts';

// A fake MediaMTX: one path can be "live", with a growing byte counter.
const live = new Map<string, { bytes: number; viewers: number }>();
const kicked: string[] = [];
const mtx: MediaMtx = {
  async path(name) {
    const p = live.get(name);
    if (!p) return null;
    p.bytes += 1000;
    return { ready: true, viewers: p.viewers, bytesReceived: p.bytes };
  },
  async sessions() {
    return [...live.keys()].flatMap(path => [
      { id: `pub-${path}`, path, state: 'publish' },
      { id: `read-${path}`, path, state: 'read' },
    ]);
  },
  async kick(id) {
    kicked.push(id);
  },
  async offer(kind, path, sdp) {
    if (kind === 'whip') live.set(path, { bytes: 0, viewers: 0 });
    else if (!live.has(path)) return { status: 404, sdp: '', session: null };
    else live.get(path)!.viewers += 1;
    return { status: 201, sdp: `v=0 answer for ${sdp.length}`, session: 'sess-1' };
  },
  async session() {
    return 200;
  },
};

const config = loadConfig({
  TOKEN_SECRET: 'x'.repeat(40),
  MTX_SECRET: 'y'.repeat(30),
  PUBLIC_URL: 'https://203-0-113-25.sslip.io',
  MAX_STREAMS_PER_IP: '2',
});
const app = createApp({ config, mtx, log: () => {} });
let server: Server;
let base = '';

before(async () => {
  server = createServer(app.handler);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});
after(() => server.close());

const json = (method: string, path: string, body?: unknown, token?: string) =>
  fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const sdp = (path: string, token: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp', Authorization: `Bearer ${token}` },
    body: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n',
  });

test('config refuses weak secrets and bad URLs', () => {
  assert.throws(() => loadConfig({ TOKEN_SECRET: 'short', MTX_SECRET: 'y'.repeat(30), PUBLIC_URL: 'https://a' }));
  assert.throws(() => loadConfig({ TOKEN_SECRET: 'x'.repeat(40), MTX_SECRET: 'y'.repeat(30), PUBLIC_URL: 'a/b' }));
});

test('viewer tokens expire and cannot be forged', () => {
  const secret = Buffer.from('k'.repeat(40));
  const t = issueViewerToken(secret, { pid: 'abc123', exp: 2000 });
  assert.deepEqual(readViewerToken(secret, t, 1_000_000), { pid: 'abc123', exp: 2000 });
  assert.equal(readViewerToken(secret, t, 2_000_001), null);
  assert.equal(readViewerToken(Buffer.from('z'.repeat(40)), t, 1_000_000), null);
  assert.equal(readViewerToken(secret, `${t}x`, 1_000_000), null);
});

test('rate limiter', () => {
  const rl = new RateLimiter(2, 1000);
  assert.ok(rl.take('a', 0));
  assert.ok(rl.take('a', 1));
  assert.ok(!rl.take('a', 2));
  assert.ok(rl.take('a', 1001));
});

test('full flow: create, publish, watch, private, regenerate, revoke, end', async () => {
  const r = await json('POST', '/api/streams', { title: 'Garden', maxViewers: 1 });
  assert.equal(r.status, 201);
  const s = (await r.json()) as Record<string, string>;
  assert.match(s.viewerUrl, /^https:\/\/203-0-113-25\.sslip\.io\/s\//);
  const owner = s.ownerToken;

  // Not live yet.
  let v = (await (await json('POST', `/api/view/${s.publicId}`, {})).json()) as Record<string, unknown>;
  assert.equal(v.live, false);

  // Publish needs the owner token.
  assert.equal((await sdp(`/api/streams/${s.id}/whip`, 'wrong')).status, 404);
  const pub = await sdp(`/api/streams/${s.id}/whip`, owner);
  assert.equal(pub.status, 201);
  assert.equal(pub.headers.get('location'), `/api/streams/${s.id}/whip/sess-1`);

  v = (await (await json('POST', `/api/view/${s.publicId}`, {})).json()) as Record<string, unknown>;
  assert.equal(v.live, true);
  const token = v.token as string;
  assert.equal((await sdp(`/api/view/${s.publicId}/whep`, 'bad')).status, 401);
  assert.equal((await sdp(`/api/view/${s.publicId}/whep`, token)).status, 201);
  // maxViewers 1 → the second is refused.
  assert.equal((await sdp(`/api/view/${s.publicId}/whep`, token)).status, 403);

  // Private: password needed, wrong one refused.
  assert.equal((await json('PATCH', `/api/streams/${s.id}`, { access: 'private' }, owner)).status, 400);
  assert.equal((await json('PATCH', `/api/streams/${s.id}`, { access: 'private', password: 'pa55word' }, owner)).status, 200);
  assert.equal((await json('POST', `/api/view/${s.publicId}`, {})).status, 401);
  assert.equal((await json('POST', `/api/view/${s.publicId}`, { password: 'nope' })).status, 403);
  assert.equal((await json('POST', `/api/view/${s.publicId}`, { password: 'pa55word' })).status, 200);

  // Regenerate: old link and its tokens stop working, viewers kicked.
  const g = (await (await json('POST', `/api/streams/${s.id}/regenerate`, undefined, owner)).json()) as Record<string, string>;
  assert.notEqual(g.publicId, s.publicId);
  assert.equal((await json('POST', `/api/view/${s.publicId}`, { password: 'pa55word' })).status, 404);
  assert.ok(kicked.some(k => k.startsWith('read-')));
  assert.ok(!kicked.some(k => k.startsWith('pub-')));

  // Revoke: no link at all.
  const rv = (await (await json('POST', `/api/streams/${s.id}/revoke`, undefined, owner)).json()) as Record<string, unknown>;
  assert.equal(rv.publicId, null);
  assert.equal(rv.viewerUrl, null);

  // End.
  assert.equal((await json('DELETE', `/api/streams/${s.id}`, undefined, owner)).status, 204);
  assert.equal((await json('GET', `/api/streams/${s.id}`, undefined, owner)).status, 404);
});

test('limits streams per address', async () => {
  const a = await json('POST', '/api/streams', {});
  const b = await json('POST', '/api/streams', {});
  const c = await json('POST', '/api/streams', {});
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(c.status, 429);
});

test('MediaMTX auth hook only lets the signal server in', async () => {
  const hook = (key: string, body: unknown) =>
    fetch(`${base}/internal/mtx-auth?key=${encodeURIComponent(key)}`, { method: 'POST', body: JSON.stringify(body) });
  const ok = { user: 'signal', password: 'y'.repeat(30), action: 'read', path: 's_x' };
  assert.equal((await hook('y'.repeat(30), ok)).status, 200);
  assert.equal((await hook('wrong', ok)).status, 401);
  assert.equal((await hook('y'.repeat(30), { ...ok, password: 'guess' })).status, 401);
  assert.equal((await hook('y'.repeat(30), { ...ok, action: 'playback' })).status, 401);
});

test('viewer page is served with a strict CSP', async () => {
  const r = await fetch(`${base}/s/abcdefgh`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
});
