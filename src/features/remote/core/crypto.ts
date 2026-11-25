import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  concatBytes,
  equalBytes,
  hexOf,
  readU32be,
  u32be,
  utf8,
} from './bytes';
import { PROTOCOL_LABEL } from './constants';
import { formatDeviceId } from './ids';

/*
 * The remote-access cryptography, byte-for-byte the same as the desktop app
 * (electron/main/remote/core/crypto.ts, which uses Node's crypto):
 *
 *   identity    Ed25519, one per installation; the device ID is derived from it
 *   key share   X25519, fresh per connection (forward secrecy)
 *   transport   AES-256-GCM, one key per direction, strict counters (channel.ts)
 *   password    Argon2id → verifier; proven with HMAC over the handshake
 *
 * Pure JavaScript (audited @noble libraries); randomness comes from
 * crypto.getRandomValues (react-native-get-random-values on the phone).
 */

/** Ed25519 public keys travel as SPKI DER, as Node exports them. */
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export interface LocalIdentity {
  id: string;
  name: string;
  os: string;
  platform: string;
  /** Ed25519 public key, SPKI DER (44 bytes). */
  publicKey: Uint8Array;
  /** Ed25519 seed (32 bytes). */
  secretKey: Uint8Array;
}

export const generateIdentitySecret = (): Uint8Array =>
  ed25519.utils.randomSecretKey();

export const spkiFromSecret = (secret: Uint8Array): Uint8Array =>
  concatBytes(ED25519_SPKI_PREFIX, ed25519.getPublicKey(secret));

/** The raw 32-byte key inside an Ed25519 SPKI, or null if it is not one. */
export const rawFromSpki = (spki: Uint8Array): Uint8Array | null => {
  if (spki.length !== 44) return null;
  if (!equalBytes(spki.subarray(0, 12), ED25519_SPKI_PREFIX)) return null;
  return spki.subarray(12);
};

export const isEd25519PublicKey = (spki: Uint8Array): boolean => {
  const raw = rawFromSpki(spki);
  if (!raw) return false;
  try {
    return ed25519.utils.isValidPublicKey(raw);
  } catch {
    return false;
  }
};

const keyNumber = (spki: Uint8Array): bigint => {
  const digest = sha256(spki);
  const view = new DataView(digest.buffer, digest.byteOffset, 8);
  return view.getBigUint64(0);
};

/** The 8-digit device ID: SHA-256 of the public key, first 8 bytes mod 10⁸. */
export const deviceIdFromPublicKey = (spki: Uint8Array): string =>
  formatDeviceId((keyNumber(spki) % 100_000_000n).toString());

/** The ID desktop builds up to 0.1.5 compare exactly (WD-123-456-789). */
export const legacyDeviceIdFromPublicKey = (spki: Uint8Array): string => {
  const digits = (keyNumber(spki) % 1_000_000_000n).toString().padStart(9, '0');
  return `WD-${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`;
};

/** 128-bit fingerprint, 8 groups of 4 hex digits. */
export const fingerprintOf = (spki: Uint8Array): string =>
  hexOf(sha256(spki))
    .slice(0, 32)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1 ');

export const signTranscript = (
  secret: Uint8Array,
  transcript: Uint8Array,
): Uint8Array => ed25519.sign(transcript, secret);

export const verifyTranscript = (
  spki: Uint8Array,
  transcript: Uint8Array,
  signature: Uint8Array,
): boolean => {
  const raw = rawFromSpki(spki);
  if (!raw || signature.length !== 64) return false;
  try {
    return ed25519.verify(signature, transcript, raw);
  } catch {
    return false;
  }
};

// ── ephemeral key exchange ──────────────────────────────────────────────────

export interface Ephemeral {
  publicRaw: Uint8Array;
  secret: Uint8Array;
}

export const generateEphemeral = (): Ephemeral => {
  const secret = x25519.utils.randomSecretKey();
  return { secret, publicRaw: x25519.getPublicKey(secret) };
};

export const sharedSecret = (
  own: Ephemeral,
  peerRaw: Uint8Array,
): Uint8Array => {
  if (peerRaw.length !== 32) throw new Error('Bad key share.');
  const secret = x25519.getSharedSecret(own.secret, peerRaw);
  // An all-zero result means a low-order point: refuse it.
  if (secret.every(b => b === 0)) throw new Error('Bad key share.');
  return secret;
};

/** Hash of both hello frames, exactly as sent: what both sides sign and bind keys to. */
export const transcriptHash = (
  clientHello: Uint8Array,
  hostHello: Uint8Array,
): Uint8Array =>
  sha256(
    concatBytes(
      utf8(PROTOCOL_LABEL),
      u32be(clientHello.length),
      clientHello,
      u32be(hostHello.length),
      hostHello,
    ),
  );

export interface SessionKeys {
  clientToHost: Uint8Array;
  hostToClient: Uint8Array;
  /** 6 digits shown on both screens during an attended request. */
  verificationCode: string;
}

export const deriveSessionKeys = (
  secret: Uint8Array,
  transcript: Uint8Array,
): SessionKeys => {
  const derive = (info: string, length = 32): Uint8Array =>
    hkdf(sha256, secret, transcript, utf8(`${PROTOCOL_LABEL} ${info}`), length);
  const sas = readU32be(derive('verification', 4)) % 1_000_000;
  return {
    clientToHost: derive('c2h'),
    hostToClient: derive('h2c'),
    verificationCode: String(sas)
      .padStart(6, '0')
      .replace(/^(\d{3})(\d{3})$/, '$1 $2'),
  };
};

// ── passwords ───────────────────────────────────────────────────────────────

export interface KdfParams {
  t: number;
  m: number;
  p: number;
}

/**
 * What a phone uses when IT is the host: OWASP's Argon2id minimum (19 MiB,
 * 2 passes) rather than the desktop's 64 MiB — pure-JS Argon2 on a phone is
 * several times slower, and every connecting device pays this cost once.
 */
export const MOBILE_HOST_KDF: KdfParams = { t: 2, m: 19_456, p: 1 };

/** A host cannot make us burn unlimited CPU / memory. */
export const kdfParamsAcceptable = (p: KdfParams): boolean =>
  Number.isInteger(p.t) &&
  p.t >= 1 &&
  p.t <= 10 &&
  Number.isInteger(p.m) &&
  p.m >= 8 &&
  p.m <= 262_144 &&
  Number.isInteger(p.p) &&
  p.p >= 1 &&
  p.p <= 4;

/**
 * A native Argon2id (the platform module, see services/native.service.ts).
 * Pure JS takes about a minute for the desktop's 64 MiB setting on a phone,
 * longer than the computer waits for the answer.
 */
export type NativeArgon2 = (
  password: Uint8Array,
  salt: Uint8Array,
  params: KdfParams & { dkLen: number },
) => Promise<Uint8Array>;

let nativeArgon2: NativeArgon2 | null = null;
export const setNativeArgon2 = (fn: NativeArgon2 | null): void => {
  nativeArgon2 = fn;
};

/**
 * Recent results, in memory only, so connecting again to the same computer
 * with the same password is instant. Keyed by a hash, never the password.
 */
const verifierCache = new Map<string, Uint8Array>();
const VERIFIER_CACHE_SIZE = 8;

export const clearVerifierCache = (): void => verifierCache.clear();

export const passwordVerifier = async (
  password: string,
  salt: Uint8Array,
  params: KdfParams,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> => {
  const pw = utf8(password.normalize('NFKC'));
  const key = hexOf(
    sha256(
      concatBytes(
        utf8(`${params.t}:${params.m}:${params.p}:`),
        sha256(salt),
        sha256(pw),
      ),
    ),
  );
  const cached = verifierCache.get(key);
  if (cached) return cached.slice();
  let verifier: Uint8Array | null = null;
  if (nativeArgon2) {
    try {
      verifier = await nativeArgon2(pw, salt, { ...params, dkLen: 32 });
      if (verifier.length !== 32) verifier = null;
    } catch {
      verifier = null; // fall back to JS below
    }
  }
  verifier ??= await argon2idAsync(pw, salt, {
    ...params,
    dkLen: 32,
    asyncTick: 25,
    ...(onProgress ? { onProgress } : {}),
  });
  verifierCache.set(key, verifier.slice());
  if (verifierCache.size > VERIFIER_CACHE_SIZE)
    verifierCache.delete(verifierCache.keys().next().value as string);
  return verifier;
};

export const passwordProof = (
  verifier: Uint8Array,
  transcript: Uint8Array,
): Uint8Array =>
  hmac(
    sha256,
    verifier,
    concatBytes(utf8(`${PROTOCOL_LABEL} password`), transcript),
  );

export const resumeProof = (
  token: Uint8Array,
  transcript: Uint8Array,
): Uint8Array =>
  hmac(
    sha256,
    token,
    concatBytes(utf8(`${PROTOCOL_LABEL} resume`), transcript),
  );

export const randomToken = (bytes = 32): Uint8Array => randomBytes(bytes);
