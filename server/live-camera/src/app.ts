import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Config } from './config.ts';
import {
  hashPassword,
  issueViewerToken,
  readViewerToken,
  sameSecret,
  turnCredentials,
  verifyPassword,
} from './crypto.ts';
import { MTX_USER, type MediaMtx } from './mediamtx.ts';
import { RateLimiter } from './rateLimit.ts';
import { cleanTitle, PASSWORD_MAX, StreamStore, type Access, type Stream } from './streams.ts';

/*
 * HTTP API + viewer page. Routes:
 *
 *   owner (phone)  Authorization: Bearer <ownerToken>
 *     POST   /api/streams                     create → id, ownerToken, viewerUrl, iceServers
 *     GET    /api/streams/:id                 live?, viewers, link
 *     PATCH  /api/streams/:id                 title / access / password / maxViewers
 *     POST   /api/streams/:id/regenerate      new link, old link + viewers dropped
 *     POST   /api/streams/:id/revoke          no link until regenerated, viewers dropped
 *     DELETE /api/streams/:id                 end the stream
 *     POST   /api/streams/:id/whip            SDP offer → answer (publish)
 *     PATCH|DELETE /api/streams/:id/whip/:s   trickle ICE / unpublish
 *
 *   viewer (browser)  Authorization: Bearer <viewerToken>
 *     GET    /s/:publicId                     the viewer page
 *     POST   /api/view/:publicId              {password?} → viewer token (+ title, live)
 *     GET    /api/view/:publicId/status       live?, fresh token
 *     POST   /api/view/:publicId/whep         SDP offer → answer (watch)
 *     PATCH|DELETE /api/view/:publicId/whep/:s
 *
 *   MediaMTX   POST /internal/mtx-auth?key=…   auth hook (only our own requests pass)
 */

export const VERSION = '1.0.0';
const BODY_MAX = 64 * 1024;
const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, headers: Record<string, string> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export interface AppDeps {
  config: Config;
  mtx: MediaMtx;
  store?: StreamStore;
  log?: (msg: string) => void;
  now?: () => number;
}

export const createApp = (deps: AppDeps) => {
  const { config, mtx } = deps;
  const store = deps.store ?? new StreamStore();
  const log = deps.log ?? ((m: string) => console.log(`${new Date().toISOString()} ${m}`));
  const now = deps.now ?? Date.now;

  const limits = {
    api: new RateLimiter(600, 60_000),
    create: new RateLimiter(10, 3_600_000),
    view: new RateLimiter(60, 60_000),
    password: new RateLimiter(10, 15 * 60_000),
    whep: new RateLimiter(30, 60_000),
    whip: new RateLimiter(30, 60_000),
  };

  // ── helpers ──

  const clientIp = (req: IncomingMessage): string => {
    if (config.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  };

  const limit = (rl: RateLimiter, key: string) => {
    if (!rl.take(key, now())) throw new HttpError(429, 'rate_limited', { 'Retry-After': String(rl.retryAfter(key, now())) });
  };

  const bearer = (req: IncomingMessage): string | null => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7).trim() || null : null;
  };

  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > BODY_MAX) {
          reject(new HttpError(413, 'too_large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });

  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const text = await readBody(req);
    if (!text) return {};
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* fall through */
    }
    throw new HttpError(400, 'bad_json');
  };

  const readSdp = async (req: IncomingMessage): Promise<string> => {
    const type = req.headers['content-type'] ?? '';
    if (!type.startsWith('application/sdp')) throw new HttpError(415, 'expected_sdp');
    const sdp = await readBody(req);
    if (!sdp.startsWith('v=0')) throw new HttpError(400, 'bad_sdp');
    return sdp;
  };

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(text ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    });
    res.end(text);
  };

  const sendSdp = (res: ServerResponse, status: number, sdp: string, location: string | null) => {
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/sdp',
      ...(location ? { Location: location, 'Access-Control-Expose-Headers': 'Location' } : {}),
    });
    res.end(sdp);
  };

  const iceServers = () => {
    const list: { urls: string[]; username?: string; credential?: string }[] = [];
    if (config.stunUrls.length) list.push({ urls: config.stunUrls });
    if (config.turnSecret && config.turnUrls.length) {
      list.push({ urls: config.turnUrls, ...turnCredentials(config.turnSecret, 3600, now()) });
    }
    return list;
  };

  const viewerUrl = (s: Stream) => (s.publicId ? `${config.publicUrl}/s/${s.publicId}` : null);
  const expiresAt = (s: Stream) => s.createdAt + config.maxStreamLifetimeSec * 1000;

  const settingsFrom = async (body: Record<string, unknown>, current?: Stream) => {
    const title = body.title === undefined && current ? current.title : cleanTitle(body.title);
    const access: Access =
      body.access === undefined && current ? current.access : body.access === 'private' ? 'private' : 'public';
    const rawMax = body.maxViewers === undefined && current ? current.maxViewers : Number(body.maxViewers ?? 10);
    if (!Number.isInteger(rawMax) || rawMax < 1) throw new HttpError(400, 'bad_max_viewers');
    const maxViewers = Math.min(rawMax, config.maxViewersCap);
    let passwordHash = current?.passwordHash ?? null;
    if (typeof body.password === 'string' && body.password.length > 0) {
      if (body.password.length < 4 || body.password.length > PASSWORD_MAX) throw new HttpError(400, 'bad_password');
      passwordHash = await hashPassword(body.password);
    } else if (body.password === null) passwordHash = null;
    if (access === 'private' && !passwordHash) throw new HttpError(400, 'password_required');
    if (access === 'public') passwordHash = null;
    return { settings: { title: title || 'Live camera', access, maxViewers }, passwordHash };
  };

  /** Media stopped arriving this long ago = offline, even if MediaMTX still holds the session. */
  const STALL_MS = 4000;

  const pathInfo = async (s: Stream) => {
    const info = await mtx.path(s.path).catch(() => null);
    if (!info?.ready) return { ready: false, viewers: info?.viewers ?? 0 };
    const t = now();
    if (info.bytesReceived !== s.lastBytes || !s.lastBytesAt) {
      s.lastBytes = info.bytesReceived;
      s.lastBytesAt = t;
    }
    const ready = t - s.lastBytesAt < STALL_MS;
    if (ready) s.lastLiveAt = t;
    return { ready, viewers: info.viewers };
  };

  const kickReaders = async (s: Stream, includePublisher = false) => {
    const list = await mtx.sessions().catch(() => []);
    await Promise.all(
      list.filter(x => x.path === s.path && (includePublisher || x.state === 'read')).map(x => mtx.kick(x.id)),
    );
  };

  const ownerView = async (s: Stream) => {
    const info = await pathInfo(s);
    return {
      id: s.id,
      publicId: s.publicId,
      viewerUrl: viewerUrl(s),
      live: info.ready,
      viewers: info.viewers,
      title: s.title,
      access: s.access,
      maxViewers: s.maxViewers,
      hasPassword: !!s.passwordHash,
      createdAt: s.createdAt,
      expiresAt: expiresAt(s),
    };
  };

  const short = (id: string) => id.slice(0, 6);

  // ── owner ──

  const owned = (req: IncomingMessage, id: string): Stream => {
    const s = store.owned(id, bearer(req));
    if (!s) throw new HttpError(404, 'not_found');
    return s;
  };

  const createStream = async (req: IncomingMessage, res: ServerResponse, ip: string) => {
    limit(limits.create, ip);
    if (store.size >= config.maxStreams) throw new HttpError(503, 'server_full');
    if (store.countByIp(ip) >= config.maxStreamsPerIp) throw new HttpError(429, 'too_many_streams');
    const { settings, passwordHash } = await settingsFrom(await readJson(req));
    const { stream, ownerToken } = store.create(settings, passwordHash, ip, now());
    log(`stream ${short(stream.id)} created (${stream.access}, max ${stream.maxViewers})`);
    send(res, 201, {
      ...(await ownerView(stream)),
      ownerToken,
      whipUrl: `${config.publicUrl}/api/streams/${stream.id}/whip`,
      iceServers: iceServers(),
    });
  };

  const ownerRoute = async (req: IncomingMessage, res: ServerResponse, id: string, rest: string[]) => {
    const s = owned(req, id);
    const m = req.method;
    if (rest.length === 0 && m === 'GET') return send(res, 200, await ownerView(s));
    if (rest.length === 0 && m === 'PATCH') {
      const { settings, passwordHash } = await settingsFrom(await readJson(req), s);
      // A lower limit keeps the viewers already watching; new ones are refused.
      Object.assign(s, settings, { passwordHash });
      return send(res, 200, await ownerView(s));
    }
    if (rest.length === 0 && m === 'DELETE') {
      store.remove(s);
      await kickReaders(s, true);
      log(`stream ${short(s.id)} ended by owner`);
      return send(res, 204, undefined);
    }
    if (rest[0] === 'regenerate' && rest.length === 1 && m === 'POST') {
      store.regenerate(s);
      await kickReaders(s);
      log(`stream ${short(s.id)} link regenerated`);
      return send(res, 200, await ownerView(s));
    }
    if (rest[0] === 'revoke' && rest.length === 1 && m === 'POST') {
      store.revoke(s);
      await kickReaders(s);
      log(`stream ${short(s.id)} link revoked`);
      return send(res, 200, await ownerView(s));
    }
    if (rest[0] === 'whip') {
      limit(limits.whip, s.id);
      if (rest.length === 1 && m === 'POST') {
        const r = await mtx.offer('whip', s.path, await readSdp(req));
        if (r.status !== 201) {
          log(`stream ${short(s.id)} publish refused by media server (${r.status})`);
          throw new HttpError(502, 'media_server_error');
        }
        s.lastLiveAt = now();
        log(`stream ${short(s.id)} publishing`);
        return sendSdp(res, 201, r.sdp, r.session ? `/api/streams/${s.id}/whip/${encodeURIComponent(r.session)}` : null);
      }
      if (rest.length === 2 && (m === 'PATCH' || m === 'DELETE')) {
        const body = m === 'PATCH' ? await readBody(req) : undefined;
        const status = await mtx.session('whip', s.path, rest[1]!, m, body);
        return send(res, status >= 200 && status < 300 ? 204 : status, undefined);
      }
    }
    throw new HttpError(405, 'method_not_allowed');
  };

  // ── viewer ──

  const viewStream = (publicId: string): Stream => {
    const s = store.byPublic(publicId);
    if (!s) throw new HttpError(404, 'not_found');
    return s;
  };

  const viewerToken = (s: Stream) => ({
    token: issueViewerToken(config.tokenSecret, { pid: s.publicId!, exp: Math.floor(now() / 1000) + config.viewerTokenTtlSec }),
    tokenTtl: config.viewerTokenTtlSec,
  });

  const viewerClaims = (req: IncomingMessage, s: Stream) => {
    const c = readViewerToken(config.tokenSecret, bearer(req) ?? '', now());
    if (!c || c.pid !== s.publicId) throw new HttpError(401, 'token_expired');
    return c;
  };

  const viewerRoute = async (req: IncomingMessage, res: ServerResponse, ip: string, publicId: string, rest: string[]) => {
    const m = req.method;
    if (rest.length === 0 && m === 'POST') {
      limit(limits.view, ip);
      const s = viewStream(publicId);
      const body = await readJson(req);
      if (s.access === 'private') {
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password) throw new HttpError(401, 'password_required');
        const key = `${ip}|${publicId}`;
        limit(limits.password, key);
        if (password.length > PASSWORD_MAX || !(await verifyPassword(password, s.passwordHash ?? ''))) {
          throw new HttpError(403, 'wrong_password');
        }
      }
      const info = await pathInfo(s);
      return send(res, 200, { title: s.title, access: s.access, live: info.ready, ...viewerToken(s), iceServers: iceServers() });
    }
    const s = viewStream(publicId);
    if (rest[0] === 'status' && rest.length === 1 && m === 'GET') {
      limit(limits.view, ip);
      viewerClaims(req, s);
      const info = await pathInfo(s);
      return send(res, 200, { title: s.title, live: info.ready, ...viewerToken(s) });
    }
    if (rest[0] === 'whep') {
      viewerClaims(req, s);
      if (rest.length === 1 && m === 'POST') {
        limit(limits.whep, ip);
        const sdp = await readSdp(req);
        const info = await pathInfo(s);
        if (!info.ready) throw new HttpError(409, 'offline');
        if (info.viewers >= s.maxViewers) throw new HttpError(403, 'full');
        const r = await mtx.offer('whep', s.path, sdp);
        if (r.status === 404) throw new HttpError(409, 'offline');
        if (r.status !== 201) throw new HttpError(502, 'media_server_error');
        return sendSdp(res, 201, r.sdp, r.session ? `/api/view/${publicId}/whep/${encodeURIComponent(r.session)}` : null);
      }
      if (rest.length === 2 && (m === 'PATCH' || m === 'DELETE')) {
        const body = m === 'PATCH' ? await readBody(req) : undefined;
        const status = await mtx.session('whep', s.path, rest[1]!, m, body);
        return send(res, status >= 200 && status < 300 ? 204 : status, undefined);
      }
    }
    throw new HttpError(405, 'method_not_allowed');
  };

  // ── MediaMTX auth hook ──

  const mtxAuth = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const key = url.searchParams.get('key') ?? '';
    const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
    const ok =
      sameSecret(key, config.mtxSecret) &&
      body.user === MTX_USER &&
      typeof body.password === 'string' &&
      sameSecret(body.password, config.mtxSecret) &&
      ['publish', 'read', 'api'].includes(String(body.action));
    send(res, ok ? 200 : 401, undefined);
  };

  // ── static ──

  const serveFile = async (res: ServerResponse, name: string, extra: Record<string, string> = {}) => {
    const body = await readFile(join(PUBLIC_DIR, name));
    res.writeHead(200, {
      'Content-Type': MIME[extname(name)] ?? 'application/octet-stream',
      'Cache-Control': name.endsWith('.html') ? 'no-store' : 'no-cache',
      ...PAGE_HEADERS,
      ...extra,
    });
    res.end(body);
  };

  const STATIC = new Set(['viewer.js', 'viewer.css', 'favicon.svg']);
  const ID = /^[A-Za-z0-9_-]{6,64}$/;

  // ── router ──

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const parts = url.pathname.split('/').filter(Boolean);
    const ip = clientIp(req);
    const m = req.method ?? 'GET';

    if (parts[0] === 'internal' && parts[1] === 'mtx-auth' && m === 'POST') return mtxAuth(req, res, url);
    if (url.pathname === '/healthz') return send(res, 200, { ok: true, name: 'live-camera', version: VERSION, streams: store.size });
    if (url.pathname === '/' && m === 'GET') return serveFile(res, 'index.html');
    if (parts[0] === 's' && parts.length === 2 && m === 'GET') return serveFile(res, 'viewer.html');
    if (parts.length === 1 && STATIC.has(parts[0]!) && m === 'GET') return serveFile(res, parts[0]!);

    if (parts[0] === 'api') {
      limit(limits.api, ip);
      if (parts[1] === 'streams') {
        if (parts.length === 2 && m === 'POST') return createStream(req, res, ip);
        if (parts[2] && ID.test(parts[2])) return ownerRoute(req, res, parts[2], parts.slice(3));
      }
      if (parts[1] === 'view' && parts[2] && ID.test(parts[2])) return viewerRoute(req, res, ip, parts[2], parts.slice(3));
    }
    throw new HttpError(404, 'not_found');
  };

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) return res.end();
      if (err instanceof HttpError) return send(res, err.status, { error: err.code }, err.headers);
      log(`error ${req.method} ${(req.url ?? '').split('?')[0]?.replace(/\/[A-Za-z0-9_-]{16,}/g, '/…')}: ${(err as Error).message}`);
      send(res, 500, { error: 'internal' });
    });
  };

  /** Removes streams that have been offline too long or lived too long. */
  const cleanup = async () => {
    const t = now();
    for (const s of store.all()) {
      await pathInfo(s);
      const offline = t - s.lastLiveAt > config.offlineTtlSec * 1000;
      const tooOld = t > expiresAt(s);
      if (offline || tooOld) {
        store.remove(s);
        await kickReaders(s, true);
        log(`stream ${short(s.id)} removed (${tooOld ? 'max lifetime' : 'offline'})`);
      }
    }
    for (const rl of Object.values(limits)) rl.sweep(t);
  };

  return { handler, cleanup, store };
};
