import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** Unguessable URL-safe identifier (`bytes` of randomness). */
export const randomId = (bytes: number): string => randomBytes(bytes).toString('base64url');

export const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time comparison of two strings (via their hashes, so lengths leak nothing). */
export const sameSecret = (a: string, b: string): boolean => timingSafeEqual(sha256(a), sha256(b));

// ── stream passwords (scrypt) ──

const scryptAsync = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `${salt.toString('base64url')}.${key.toString('base64url')}`;
};

export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const [salt, key] = stored.split('.');
  if (!salt || !key) return false;
  const got = await scryptAsync(password, Buffer.from(salt, 'base64url'));
  const want = Buffer.from(key, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
};

// ── viewer tokens: base64url(json).hmac — stateless, expiring, bound to a link ──

export interface ViewerClaims {
  /** The public link id the token was issued for: a regenerated / revoked link invalidates it. */
  pid: string;
  /** Expiry, unix seconds. */
  exp: number;
}

const sign = (secret: Buffer, payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

export const issueViewerToken = (secret: Buffer, claims: ViewerClaims): string => {
  const payload = Buffer.from(JSON.stringify({ ...claims, n: randomId(6) })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
};

export const readViewerToken = (secret: Buffer, token: string, now = Date.now()): ViewerClaims | null => {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(secret, payload));
  const got = Buffer.from(mac);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<ViewerClaims>;
    if (typeof c.pid !== 'string' || typeof c.exp !== 'number') return null;
    if (c.exp * 1000 <= now) return null;
    return { pid: c.pid, exp: c.exp };
  } catch {
    return null;
  }
};

// ── TURN REST credentials (coturn use-auth-secret) ──

export const turnCredentials = (secret: string, ttlSec: number, now = Date.now()) => {
  const username = `${Math.floor(now / 1000) + ttlSec}:live`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
};
