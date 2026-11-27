/**
 * Server settings, all from environment variables (see .env.example). Nothing
 * is hard-coded: no address, password or key. Invalid values stop the server
 * at start-up instead of misbehaving later.
 */

export interface Config {
  /** Address the HTTP server listens on (behind Caddy in production). */
  host: string;
  port: number;
  /** Public base URL viewers open, e.g. https://203-0-113-25.sslip.io (no trailing slash). */
  publicUrl: string;
  /** Trust X-Forwarded-For (only behind your own reverse proxy). */
  trustProxy: boolean;
  /** HMAC key for viewer tokens. */
  tokenSecret: Buffer;
  /** Shared secret between this server and MediaMTX (auth hook + basic auth). */
  mtxSecret: string;
  /** MediaMTX WebRTC HTTP (WHIP/WHEP) and API, reachable only from this server. */
  mtxWebrtcUrl: string;
  mtxApiUrl: string;
  /** coturn REST secret (use-auth-secret) and TURN URLs; empty = no TURN. */
  turnSecret: string;
  turnUrls: string[];
  stunUrls: string[];
  viewerTokenTtlSec: number;
  /** A stream that has not been live for this long is removed. */
  offlineTtlSec: number;
  maxStreamLifetimeSec: number;
  maxStreams: number;
  maxStreamsPerIp: number;
  maxViewersCap: number;
}

const str = (env: NodeJS.ProcessEnv, key: string, fallback?: string): string => {
  const v = env[key]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`[config] ${key} is required (see .env.example)`);
};

const int = (env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number => {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`[config] ${key} must be an integer ${min}–${max}`);
  return n;
};

const list = (v: string): string[] =>
  v
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const noSlash = (url: string): string => url.replace(/\/+$/, '');

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const tokenSecret = str(env, 'TOKEN_SECRET');
  const mtxSecret = str(env, 'MTX_SECRET');
  if (tokenSecret.length < 32) throw new Error('[config] TOKEN_SECRET must be at least 32 characters');
  if (mtxSecret.length < 24) throw new Error('[config] MTX_SECRET must be at least 24 characters');
  const publicUrl = noSlash(str(env, 'PUBLIC_URL'));
  if (!/^https?:\/\/[^/]+$/.test(publicUrl)) throw new Error('[config] PUBLIC_URL must look like https://host[:port]');
  return {
    host: str(env, 'HOST', '0.0.0.0'),
    port: int(env, 'PORT', 8080, 1, 65535),
    publicUrl,
    trustProxy: str(env, 'TRUST_PROXY', '0') === '1',
    tokenSecret: Buffer.from(tokenSecret, 'utf8'),
    mtxSecret,
    mtxWebrtcUrl: noSlash(str(env, 'MTX_WEBRTC_URL', 'http://127.0.0.1:8889')),
    mtxApiUrl: noSlash(str(env, 'MTX_API_URL', 'http://127.0.0.1:9997')),
    turnSecret: str(env, 'TURN_SECRET', ''),
    turnUrls: list(str(env, 'TURN_URLS', '')),
    stunUrls: list(str(env, 'STUN_URLS', '')),
    viewerTokenTtlSec: int(env, 'VIEWER_TOKEN_TTL_SEC', 600, 60, 86_400),
    offlineTtlSec: int(env, 'STREAM_OFFLINE_TTL_SEC', 900, 60, 86_400),
    maxStreamLifetimeSec: int(env, 'STREAM_MAX_LIFETIME_SEC', 43_200, 600, 604_800),
    maxStreams: int(env, 'MAX_STREAMS', 50, 1, 10_000),
    maxStreamsPerIp: int(env, 'MAX_STREAMS_PER_IP', 3, 1, 1000),
    maxViewersCap: int(env, 'MAX_VIEWERS_CAP', 50, 1, 10_000),
  };
};
