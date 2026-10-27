// Akshar audio-sharing wire protocol — the browser side of
// android/.../screenocr/share/ShareProtocol.kt. Keep the two in step.
//
// Pure WebCrypto + WebSocket: runs in the extension's service worker and in
// Node (test/e2e.mjs).

export const VERSION = 1;
export const DEFAULT_PORT = 47811;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;

const TYPE_JSON = 1;
const TYPE_PCM = 2;
const DIR_SERVER_TO_CLIENT = 1;
const DIR_CLIENT_TO_SERVER = 2;
const INFO = 'akshar-audio-v1';
const HANDSHAKE_TIMEOUT_MS = 10_000;
const APPROVAL_TIMEOUT_MS = 70_000;

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** "abcde-23456" → "ABCDE23456" (dash and spaces are cosmetic). */
export function normaliseCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .split('')
    .filter(c => CODE_ALPHABET.includes(c))
    .join('');
}

/**
 * "192.168.1.23:47811" / "192.168.1.23" → ws URL; null when it isn't a
 * private (local-network) IPv4 address — the phone is never on the internet.
 */
export function addressToUrl(input) {
  const m = String(input ?? '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/);
  if (!m) return null;
  const [a, b, c, d] = m.slice(1, 5).map(Number);
  if ([a, b, c, d].some(n => n > 255)) return null;
  const local = a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!local) return null;
  const port = m[5] ? Number(m[5]) : DEFAULT_PORT;
  if (port < 1 || port > 65535) return null;
  return `ws://${a}.${b}.${c}.${d}:${port}`;
}

export function toB64(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Same derivation as ShareProtocol.deriveKeys. */
export async function deriveKeys(shared, secret, clientPub, serverPub, clientNonce, serverNonce) {
  const salt = new Uint8Array(await subtle.digest('SHA-256', secret));
  const ikm = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const info = concat(encoder.encode(INFO), clientPub, serverPub, clientNonce, serverNonce);
  const okm = new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, 96 * 8));
  const confirm = okm.slice(0, 32);
  const fp = await hmac(confirm, encoder.encode('fingerprint'));
  const digits = String(((fp[0] << 16) | (fp[1] << 8) | fp[2]) % 1_000_000).padStart(6, '0');
  return {
    clientMac: await hmac(confirm, encoder.encode('client')),
    serverMac: await hmac(confirm, encoder.encode('server')),
    clientToServer: okm.slice(32, 64),
    serverToClient: okm.slice(64, 96),
    fingerprint: `${digits.slice(0, 3)} ${digits.slice(3)}`,
  };
}

function nonce(direction, counter) {
  const iv = new DataView(new ArrayBuffer(12));
  iv.setUint32(0, direction);
  iv.setBigUint64(4, counter);
  return new Uint8Array(iv.buffer);
}

class SessionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Opens a session with the phone.
 *
 * @param {object} o
 * @param {string} o.url        ws://host:port (see addressToUrl)
 * @param {'code'|'resume'} o.mode
 * @param {Uint8Array} o.secret normalised code bytes, or the resume key
 * @param {string} o.name       shown on the phone ("Chrome on Windows")
 * @param {(fingerprint: string) => void} [o.onPending]  waiting for the phone's Allow
 * @param {(json: object) => void} o.onJson              decrypted control messages
 * @param {(rate: number, channels: number, pcm: Int16Array) => void} o.onPcm
 * @param {(reason: string) => void} o.onClose           after the session was open
 * @returns {Promise<{send(json: object): Promise<void>, close(): void, fingerprint: string, welcome: object}>}
 *          rejects with {code}: unreachable, timeout, bad_code, code_expired,
 *          busy, denied, resume_invalid, bad_server, bad_version, closed.
 */
export function openSession(o) {
  return new Promise((resolve, reject) => {
    const WS = o.WebSocket ?? globalThis.WebSocket;
    let ws;
    try {
      ws = new WS(o.url);
    } catch {
      reject(new SessionError('unreachable'));
      return;
    }
    ws.binaryType = 'arraybuffer';
    const inbox = [];
    let waiter = null;
    let open = false;
    let settled = false;
    let established = false;
    let opener = null;
    let lastCounter = 0n;
    let chain = Promise.resolve();

    const fail = code => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      reject(new SessionError(code));
    };
    let timer = setTimeout(() => fail('timeout'), HANDSHAKE_TIMEOUT_MS);

    const next = () =>
      new Promise((res, rej) => {
        if (inbox.length) res(inbox.shift());
        else waiter = { res, rej };
      });

    ws.onopen = () => {
      open = true;
    };
    ws.onerror = () => {
      if (!open) fail('unreachable');
    };
    ws.onclose = () => {
      if (waiter) waiter.rej(new SessionError(open ? 'closed' : 'unreachable'));
      waiter = null;
      if (!settled) fail(open ? 'closed' : 'unreachable');
      else if (established) chain = chain.then(() => o.onClose?.('closed'));
    };
    ws.onmessage = event => {
      if (opener) {
        // Decrypt strictly in arrival order.
        chain = chain.then(() => handleFrame(event.data)).catch(() => ws.close());
        return;
      }
      if (waiter) {
        waiter.res(event.data);
        waiter = null;
      } else inbox.push(event.data);
    };

    const readJson = async () => {
      const data = await next();
      if (typeof data !== 'string') throw new SessionError('bad_server');
      const json = JSON.parse(data);
      if (json.t === 'error') throw new SessionError(String(json.code || 'closed'));
      return json;
    };

    async function handleFrame(data) {
      if (!(data instanceof ArrayBuffer) || data.byteLength < 24) return;
      const view = new DataView(data);
      const counter = view.getBigUint64(0);
      if (counter <= lastCounter) throw new Error('replay');
      const plain = new Uint8Array(
        await subtle.decrypt({ name: 'AES-GCM', iv: nonce(DIR_SERVER_TO_CLIENT, counter) }, opener, data.slice(8)),
      );
      lastCounter = counter;
      if (plain[0] === TYPE_JSON) {
        o.onJson(JSON.parse(decoder.decode(plain.subarray(1))));
      } else if (plain[0] === TYPE_PCM && plain.length > 6) {
        const pv = new DataView(plain.buffer, plain.byteOffset);
        const rate = pv.getUint32(1);
        const channels = plain[5];
        const bytes = plain.slice(6, 6 + ((plain.length - 6) & ~1));
        o.onPcm(rate, channels, new Int16Array(bytes.buffer));
      }
    }

    (async () => {
      const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
      const clientPub = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
      const clientNonce = globalThis.crypto.getRandomValues(new Uint8Array(16));
      // Wait for the socket before sending.
      while (!open) {
        if (settled) return;
        await new Promise(r => setTimeout(r, 20));
      }
      ws.send(
        JSON.stringify({ t: 'hello', v: VERSION, mode: o.mode, pub: toB64(clientPub), nonce: toB64(clientNonce), name: o.name }),
      );
      const challenge = await readJson();
      if (challenge.t !== 'challenge') throw new SessionError('bad_server');
      const serverPub = fromB64(challenge.pub);
      const serverNonce = fromB64(challenge.nonce);
      const peer = await subtle.importKey('raw', serverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: peer }, pair.privateKey, 256));
      const keys = await deriveKeys(shared, o.secret, clientPub, serverPub, clientNonce, serverNonce);
      ws.send(JSON.stringify({ t: 'confirm', mac: toB64(keys.clientMac) }));

      const answer = await readJson();
      if (!['pending', 'ready'].includes(answer.t) || !equal(fromB64(answer.mac), keys.serverMac)) {
        // The phone didn't prove it knows the secret: not our phone.
        throw new SessionError('bad_server');
      }
      if (answer.t === 'pending') {
        clearTimeout(timer);
        timer = setTimeout(() => fail('timeout'), APPROVAL_TIMEOUT_MS);
        o.onPending?.(keys.fingerprint);
      }
      const sealKey = await subtle.importKey('raw', keys.clientToServer, 'AES-GCM', false, ['encrypt']);
      const openKey = await subtle.importKey('raw', keys.serverToClient, 'AES-GCM', false, ['decrypt']);

      // The first encrypted frame is the welcome (after the user's Allow).
      const first = await next().catch(e => {
        throw e instanceof SessionError && e.code === 'closed' ? new SessionError('denied') : e;
      });
      if (typeof first === 'string') {
        const json = JSON.parse(first);
        throw new SessionError(json.t === 'error' ? String(json.code) : 'bad_server');
      }
      let welcome = null;
      opener = openKey;
      const onJson = o.onJson;
      o.onJson = json => {
        if (!welcome && json.t === 'welcome') welcome = json;
        else onJson(json);
      };
      await handleFrame(first);
      o.onJson = onJson;
      if (!welcome) throw new SessionError('bad_server');
      // Anything that queued up during the handshake.
      for (const data of inbox.splice(0)) chain = chain.then(() => handleFrame(data));

      let counter = 0n;
      clearTimeout(timer);
      settled = true;
      established = true;
      resolve({
        fingerprint: keys.fingerprint,
        welcome,
        async send(json) {
          counter += 1n;
          const iv = nonce(DIR_CLIENT_TO_SERVER, counter);
          const body = concat(new Uint8Array([TYPE_JSON]), encoder.encode(JSON.stringify(json)));
          const sealed = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, sealKey, body));
          const head = new DataView(new ArrayBuffer(8));
          head.setBigUint64(0, counter);
          if (ws.readyState === 1) ws.send(concat(new Uint8Array(head.buffer), sealed));
        },
        close() {
          try {
            ws.close();
          } catch {}
        },
      });
    })().catch(e => {
      clearTimeout(timer);
      fail(e instanceof SessionError ? e.code : 'bad_server');
    });
  });
}
