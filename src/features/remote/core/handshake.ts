import { fromBase64, fromUtf8, toBase64, utf8, equalBytes } from './bytes';
import { Channel, type WireMessage } from './channel';
import {
  HELLO_TIMEOUT_MS,
  REMOTE_PROTOCOL_VERSION,
  REQUEST_TIMEOUT_MS,
  SESSION_MAX_FRAME,
} from './constants';
import {
  deriveSessionKeys,
  deviceIdFromPublicKey,
  fingerprintOf,
  generateEphemeral,
  isEd25519PublicKey,
  kdfParamsAcceptable,
  legacyDeviceIdFromPublicKey,
  passwordProof,
  passwordVerifier,
  randomToken,
  resumeProof,
  sharedSecret,
  signTranscript,
  transcriptHash,
  verifyTranscript,
  type KdfParams,
  type LocalIdentity,
} from './crypto';
import { cleanText, parseDeviceId } from './ids';
import type { ByteStream } from './stream';
import type {
  RemotePermission,
  RemotePlatform,
  SessionMinutes,
} from '../types';

/*
 * Connection setup, both sides — the desktop app's handshake
 * (electron/main/remote/core/handshake.ts):
 *
 *   client → host   hello  {eph, nonce, id, name, os, pub, purpose}         (raw frame C)
 *   host → client   hello  {eph, nonce, id, name, os, pub, auth modes, kdf} (raw frame H)
 *   host → client   {sig}  Ed25519(host key, T)                              (raw frame)
 *        T = SHA-256(label ‖ C ‖ H); keys = HKDF(X25519(eph, eph'), T)
 *   ── everything below is AES-256-GCM ──
 *   client → host   auth   {method, sig: Ed25519(client key, T), proof?}
 *   host → client   pending | denied | granted
 */

export interface PeerInfo {
  id: string;
  name: string;
  os: string;
  platform: RemotePlatform;
  publicKey: Uint8Array;
  fingerprint: string;
  address: string;
}

export type DenyCode =
  | 'rejected'
  | 'wrong-password'
  | 'rate-limited'
  | 'blocked'
  | 'busy'
  | 'not-accepting'
  | 'unattended-off'
  | 'timeout'
  | 'no-session'
  | 'screen-permission';

const DENY_CODES: readonly DenyCode[] = [
  'rejected',
  'wrong-password',
  'rate-limited',
  'blocked',
  'busy',
  'not-accepting',
  'unattended-off',
  'timeout',
  'no-session',
  'screen-permission',
];

/** English text the desktop also sends; the phone shows its own translation by code. */
const DENY_MESSAGES: Record<DenyCode, string> = {
  rejected: 'The person at the other computer declined the request.',
  'wrong-password': 'Wrong password.',
  'rate-limited': 'Too many failed attempts. Wait before trying again.',
  blocked: 'This computer is blocked by the other computer.',
  busy: 'The other computer is already in a remote session.',
  'not-accepting': 'The other computer does not accept remote connections.',
  'unattended-off':
    'Unattended access is off on the other computer. Connect without a password to ask the person there.',
  timeout: 'Nobody answered the request at the other computer.',
  'no-session': 'The session is over and cannot be resumed.',
  'screen-permission':
    'The other computer has not allowed this app to share its screen.',
};

export type RemoteErrorCode =
  | DenyCode
  | 'identity'
  | 'key-changed'
  | 'protocol'
  | 'cancelled'
  | 'network';

export class RemoteError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
    readonly retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

const PLATFORMS: readonly RemotePlatform[] = [
  'darwin',
  'win32',
  'linux',
  'android',
  'ios',
];

const b64 = (value: unknown, bytes?: number): Uint8Array | null => {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const buf = fromBase64(value);
  if (bytes !== undefined && buf.length !== bytes) return null;
  return buf;
};

interface ParsedHello {
  peer: Omit<PeerInfo, 'address'>;
  eph: Uint8Array;
  raw: Record<string, unknown>;
}

const parseHello = (
  frame: Uint8Array,
  role: 'client' | 'host',
): ParsedHello => {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fromUtf8(frame)) as Record<string, unknown>;
  } catch {
    throw new RemoteError('protocol', 'Not a compatible app.');
  }
  if (raw.t !== 'hello' || raw.role !== role)
    throw new RemoteError('protocol', 'Not a compatible app.');
  if (raw.v !== REMOTE_PROTOCOL_VERSION)
    throw new RemoteError('protocol', 'Incompatible app version.');
  const eph = b64(raw.eph, 32);
  const pub = b64(raw.pub);
  if (!eph || !pub || !isEd25519PublicKey(pub) || !b64(raw.nonce, 32))
    throw new RemoteError('protocol', 'Bad handshake.');
  const id = deviceIdFromPublicKey(pub);
  if (typeof raw.id !== 'string' || parseDeviceId(raw.id) !== id)
    throw new RemoteError('identity', 'The ID does not match the key.');
  return {
    eph,
    raw,
    peer: {
      id,
      name: cleanText(raw.name, 64) || id,
      os: cleanText(raw.os, 64),
      platform: PLATFORMS.includes(raw.platform as RemotePlatform)
        ? (raw.platform as RemotePlatform)
        : 'linux',
      publicKey: pub,
      fingerprint: fingerprintOf(pub),
    },
  };
};

const helloFor = (
  identity: LocalIdentity,
  role: 'client' | 'host',
  ephRaw: Uint8Array,
  extra: Record<string, unknown>,
): Uint8Array =>
  utf8(
    JSON.stringify({
      t: 'hello',
      v: REMOTE_PROTOCOL_VERSION,
      role,
      eph: toBase64(ephRaw),
      nonce: toBase64(randomToken()),
      // The old form, so desktop builds up to 0.1.5 still accept this phone.
      id: legacyDeviceIdFromPublicKey(identity.publicKey),
      name: identity.name,
      os: identity.os,
      platform: identity.platform,
      pub: toBase64(identity.publicKey),
      ...extra,
    }),
  );

// ── client ──────────────────────────────────────────────────────────────────

export interface HostInfo extends PeerInfo {
  attended: boolean;
  unattended: boolean;
  busy: boolean;
}

export interface Granted {
  sessionId: string;
  resumeToken: Uint8Array;
  permission: RemotePermission;
  expiresInMs: number | null;
  method: 'password' | 'attended' | 'resume';
  raw: WireMessage;
}

export interface ClientOptions {
  identity: LocalIdentity;
  purpose: 'connect' | 'resume' | 'probe';
  expectedId?: string;
  pinnedFingerprint?: string;
  password?: string;
  requestPermission?: RemotePermission;
  resume?: { sessionId: string; token: Uint8Array };
  onHost?: (host: HostInfo) => void;
  onPending?: (info: { verificationCode: string; expiresInMs: number }) => void;
  onPasswordProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface ClientResult {
  channel: Channel;
  host: HostInfo;
  verificationCode: string;
  granted: Granted | null;
}

export const runClientHandshake = async (
  stream: ByteStream,
  options: ClientOptions,
): Promise<ClientResult> => {
  const channel = new Channel(stream);
  const onAbort = (): void => channel.close('Cancelled.');
  options.signal?.addEventListener('abort', onAbort);
  try {
    const eph = generateEphemeral();
    const clientFrame = helloFor(options.identity, 'client', eph.publicRaw, {
      purpose: options.purpose,
    });
    channel.sendRaw(clientFrame);
    const hostFrame = await channel.receiveRaw(HELLO_TIMEOUT_MS);
    const sigFrame = await channel.receiveRaw(HELLO_TIMEOUT_MS);
    const parsed = parseHello(hostFrame, 'host');
    const transcript = transcriptHash(clientFrame, hostFrame);
    let sig: Uint8Array | null = null;
    try {
      sig = b64(
        (JSON.parse(fromUtf8(sigFrame)) as Record<string, unknown>).sig,
      );
    } catch {
      sig = null;
    }
    if (!sig || !verifyTranscript(parsed.peer.publicKey, transcript, sig))
      throw new RemoteError(
        'identity',
        'The other device could not prove its identity.',
      );
    if (options.expectedId && parsed.peer.id !== options.expectedId)
      throw new RemoteError(
        'identity',
        `That address belongs to ${parsed.peer.id}.`,
      );
    if (
      options.pinnedFingerprint &&
      parsed.peer.fingerprint !== options.pinnedFingerprint
    )
      throw new RemoteError('key-changed', 'The security key changed.');
    const kdfRaw = parsed.raw.kdf as Record<string, unknown> | null;
    const host: HostInfo = {
      ...parsed.peer,
      address: stream.remoteAddress,
      attended: parsed.raw.attended === true,
      unattended: parsed.raw.unattended === true,
      busy: parsed.raw.busy === true,
    };
    options.onHost?.(host);
    const keys = deriveSessionKeys(sharedSecret(eph, parsed.eph), transcript);
    if (options.purpose === 'probe') {
      channel.close('Probe done.');
      return {
        channel,
        host,
        verificationCode: keys.verificationCode,
        granted: null,
      };
    }
    channel.setKeys(keys.clientToHost, keys.hostToClient);
    channel.endRawMode();

    const auth: WireMessage = {
      t: 'auth',
      sig: toBase64(signTranscript(options.identity.secretKey, transcript)),
      method: 'request',
    };
    if (options.purpose === 'resume' && options.resume) {
      auth.method = 'resume';
      auth.sessionId = options.resume.sessionId;
      auth.proof = toBase64(resumeProof(options.resume.token, transcript));
    } else if (options.password) {
      if (!host.unattended || !kdfRaw)
        throw new RemoteError(
          'unattended-off',
          DENY_MESSAGES['unattended-off'],
        );
      const salt = b64(kdfRaw.salt);
      const params: KdfParams = {
        t: Number(kdfRaw.t),
        m: Number(kdfRaw.m),
        p: Number(kdfRaw.p),
      };
      if (!salt || salt.length < 16 || !kdfParamsAcceptable(params))
        throw new RemoteError('protocol', 'Unsafe password settings.');
      const verifier = await passwordVerifier(
        options.password,
        salt,
        params,
        options.onPasswordProgress,
      );
      if (channel.isClosed)
        throw new RemoteError('network', 'The connection closed.');
      auth.method = 'password';
      auth.proof = toBase64(passwordProof(verifier, transcript));
    } else {
      auth.permission = options.requestPermission ?? 'control';
    }
    channel.send(auth);

    for (;;) {
      const { msg } = await channel.receive(
        options.purpose === 'connect' && !options.password
          ? REQUEST_TIMEOUT_MS + 15_000
          : 30_000,
      );
      if (msg.t === 'pending') {
        options.onPending?.({
          verificationCode: keys.verificationCode,
          expiresInMs: Number(msg.expiresInMs) || REQUEST_TIMEOUT_MS,
        });
        continue;
      }
      if (msg.t === 'denied') {
        const code = DENY_CODES.includes(msg.code as DenyCode)
          ? (msg.code as DenyCode)
          : 'rejected';
        throw new RemoteError(
          code,
          DENY_MESSAGES[code],
          Number(msg.retryAfterMs) || 0,
        );
      }
      if (msg.t === 'granted') {
        const token = b64(msg.resumeToken, 32);
        if (typeof msg.sessionId !== 'string' || !token)
          throw new RemoteError('protocol', 'Bad answer.');
        channel.maxFrame = SESSION_MAX_FRAME;
        const expires = msg.expiresInMs;
        return {
          channel,
          host,
          verificationCode: keys.verificationCode,
          granted: {
            sessionId: msg.sessionId,
            resumeToken: token,
            permission: msg.permission === 'view' ? 'view' : 'control',
            expiresInMs:
              typeof expires === 'number' && expires > 0 ? expires : null,
            method:
              msg.method === 'password'
                ? 'password'
                : msg.method === 'resume'
                ? 'resume'
                : 'attended',
            raw: msg,
          },
        };
      }
      throw new RemoteError('protocol', 'Unexpected answer.');
    }
  } catch (error) {
    channel.close('Handshake failed.');
    if (options.signal?.aborted)
      throw new RemoteError('cancelled', 'Cancelled.');
    if (error instanceof RemoteError) throw error;
    throw new RemoteError(
      'network',
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
};

// ── host ────────────────────────────────────────────────────────────────────

export interface UnattendedSecret {
  salt: Uint8Array;
  params: KdfParams;
  verifier: Uint8Array;
  permission: RemotePermission;
  minutes: SessionMinutes;
}

export interface ApprovalRequest {
  peer: PeerInfo;
  verificationCode: string;
  requestedPermission: RemotePermission;
  expiresInMs: number;
}

export interface Approval {
  permission: RemotePermission;
  minutes: SessionMinutes;
}

export interface GrantPayload {
  sessionId: string;
  resumeToken: Uint8Array;
  permission: RemotePermission;
  expiresInMs: number | null;
  extra: Record<string, unknown>;
  onSent: () => void;
}

export interface NewSession {
  channel: Channel;
  peer: PeerInfo;
  method: 'password' | 'attended';
  permission: RemotePermission;
  minutes: SessionMinutes;
}

export interface HostPolicy {
  identity: () => LocalIdentity;
  attended: () => boolean;
  unattended: () => UnattendedSecret | null;
  busy: (peerId?: string) => boolean;
  isBlocked: (peerId: string) => boolean;
  /** Seconds-based lockout per key; 0 = may try. */
  retryAfter: (keys: string[]) => number;
  failure: (keys: string[]) => void;
  success: (keys: string[]) => void;
  approve: (
    request: ApprovalRequest,
    signal: AbortSignal,
  ) => Promise<Approval | null>;
  grant: (session: NewSession) => GrantPayload | Promise<GrantPayload>;
  resume: (
    sessionId: string,
    peer: PeerInfo,
    check: (token: Uint8Array) => boolean,
    channel: Channel,
  ) => GrantPayload | DenyCode | Promise<GrantPayload | DenyCode>;
  audit: (
    event: 'blocked' | 'auth-failed' | 'request' | 'rejected' | 'failed',
    peer: PeerInfo,
    detail: string,
  ) => void;
}

const deny = (channel: Channel, code: DenyCode, retryAfterMs = 0): void =>
  channel.closeAfter({
    t: 'denied',
    code,
    message: DENY_MESSAGES[code],
    retryAfterMs,
  });

const sendGrant = (
  channel: Channel,
  payload: GrantPayload,
  method: string,
): void => {
  channel.maxFrame = SESSION_MAX_FRAME;
  channel.send({
    t: 'granted',
    sessionId: payload.sessionId,
    resumeToken: toBase64(payload.resumeToken),
    permission: payload.permission,
    expiresInMs: payload.expiresInMs,
    method,
    ...payload.extra,
  });
  payload.onSent();
};

/** Runs the host side on a fresh connection. Never throws. */
export const runHostHandshake = async (
  stream: ByteStream,
  policy: HostPolicy,
): Promise<void> => {
  const channel = new Channel(stream);
  const address = stream.remoteAddress;
  let peer: PeerInfo | null = null;
  try {
    const clientFrame = await channel.receiveRaw(HELLO_TIMEOUT_MS);
    const client = parseHello(clientFrame, 'client');
    peer = { ...client.peer, address };
    const identity = policy.identity();
    const unattended = policy.unattended();
    const eph = generateEphemeral();
    const hostFrame = helloFor(identity, 'host', eph.publicRaw, {
      attended: policy.attended(),
      unattended: unattended !== null,
      busy: policy.busy(),
      kdf: unattended
        ? { salt: toBase64(unattended.salt), ...unattended.params }
        : null,
    });
    const transcript = transcriptHash(clientFrame, hostFrame);
    channel.sendRaw(hostFrame);
    channel.sendRaw(
      utf8(
        JSON.stringify({
          t: 'sig',
          sig: toBase64(signTranscript(identity.secretKey, transcript)),
        }),
      ),
    );
    if (client.raw.purpose === 'probe') {
      setTimeout(() => channel.close('Probe done.'), 2000);
      return;
    }
    const keys = deriveSessionKeys(sharedSecret(eph, client.eph), transcript);
    channel.setKeys(keys.hostToClient, keys.clientToHost);
    channel.endRawMode();

    const { msg } = await channel.receive(HELLO_TIMEOUT_MS);
    if (msg.t !== 'auth')
      throw new RemoteError('protocol', 'Expected authentication.');
    const sig = b64(msg.sig);
    if (!sig || !verifyTranscript(peer.publicKey, transcript, sig))
      throw new RemoteError(
        'identity',
        'The other device could not prove its identity.',
      );

    if (policy.isBlocked(peer.id)) {
      policy.audit('blocked', peer, '');
      return deny(channel, 'blocked');
    }
    const limitKeys = [`addr:${address}`, `id:${peer.id}`];
    const wait = policy.retryAfter(limitKeys);
    if (wait > 0) return deny(channel, 'rate-limited', wait);

    const method = msg.method;
    if (method === 'resume') {
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
      const proof = b64(msg.proof, 32);
      const check = (token: Uint8Array): boolean =>
        proof !== null && equalBytes(resumeProof(token, transcript), proof);
      const result = await policy.resume(sessionId, peer, check, channel);
      if (typeof result === 'string') {
        if (result === 'no-session') policy.failure(limitKeys);
        return deny(channel, result);
      }
      return sendGrant(channel, result, 'resume');
    }

    if (policy.busy(peer.id)) return deny(channel, 'busy');

    if (method === 'password') {
      if (!unattended) return deny(channel, 'unattended-off');
      const proof = b64(msg.proof, 32);
      if (
        !proof ||
        !equalBytes(passwordProof(unattended.verifier, transcript), proof)
      ) {
        policy.failure(limitKeys);
        policy.audit('auth-failed', peer, '');
        return deny(channel, 'wrong-password');
      }
      policy.success(limitKeys);
      const payload = await policy.grant({
        channel,
        peer,
        method: 'password',
        permission: unattended.permission,
        minutes: unattended.minutes,
      });
      return sendGrant(channel, payload, 'password');
    }

    if (method === 'request') {
      if (!policy.attended()) return deny(channel, 'not-accepting');
      const requested: RemotePermission =
        msg.permission === 'view' ? 'view' : 'control';
      channel.send({ t: 'pending', expiresInMs: REQUEST_TIMEOUT_MS });
      policy.audit('request', peer, requested);
      const abort = new AbortController();
      const offClose = channel.onClose(() => abort.abort());
      let timer: ReturnType<typeof setTimeout> | null = null;
      const answer = await Promise.race([
        policy.approve(
          {
            peer,
            verificationCode: keys.verificationCode,
            requestedPermission: requested,
            expiresInMs: REQUEST_TIMEOUT_MS,
          },
          abort.signal,
        ),
        new Promise<'timeout'>(resolve => {
          timer = setTimeout(() => resolve('timeout'), REQUEST_TIMEOUT_MS);
        }),
      ]);
      if (timer) clearTimeout(timer);
      offClose();
      if (channel.isClosed) {
        abort.abort();
        return;
      }
      if (answer === 'timeout') {
        abort.abort();
        policy.audit('rejected', peer, 'timeout');
        return deny(channel, 'timeout');
      }
      if (!answer) {
        policy.audit('rejected', peer, '');
        return deny(channel, 'rejected');
      }
      if (policy.busy(peer.id)) return deny(channel, 'busy');
      // A view-only request is never upgraded to control by the host's answer.
      const permission: RemotePermission =
        requested === 'view' ? 'view' : answer.permission;
      const payload = await policy.grant({
        channel,
        peer,
        method: 'attended',
        permission,
        minutes: answer.minutes,
      });
      return sendGrant(channel, payload, 'attended');
    }
    throw new RemoteError('protocol', 'Unknown authentication method.');
  } catch (error) {
    if (peer && error instanceof RemoteError)
      policy.audit('failed', peer, error.message);
    channel.close(error instanceof Error ? error.message : 'Handshake failed.');
  }
};
