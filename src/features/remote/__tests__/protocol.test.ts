import { Channel } from '../core/channel';
import { fromBase64, fromUtf8, toBase64, utf8 } from '../core/bytes';
import {
  deviceIdFromPublicKey,
  generateIdentitySecret,
  MOBILE_HOST_KDF,
  passwordVerifier,
  randomToken,
  spkiFromSecret,
  type LocalIdentity,
} from '../core/crypto';
import {
  runClientHandshake,
  runHostHandshake,
  type HostPolicy,
  type NewSession,
  type UnattendedSecret,
} from '../core/handshake';
import { ByteStream } from '../core/stream';

/** Two ByteStreams joined back to back, in memory (async like a socket). */
class MemoryStream extends ByteStream {
  peer: MemoryStream | null = null;
  constructor(readonly remoteAddress: string) {
    super();
  }
  write(bytes: Uint8Array): void {
    const peer = this.peer;
    if (this.closed || !peer) return;
    const copy = bytes.slice();
    setTimeout(() => peer.deliver(copy), 0);
  }
  deliver(bytes: Uint8Array) {
    this.received(bytes);
  }
  end(): void {
    setTimeout(() => this.destroy(), 0);
  }
  destroy(): void {
    this.finished('closed');
    if (this.peer && !this.peer.closed) {
      const p = this.peer;
      setTimeout(() => p.destroy(), 0);
    }
  }
  /** Flip one byte of the next frame (tamper test). */
  tamperNext = false;
}

const pair = (): [MemoryStream, MemoryStream] => {
  const a = new MemoryStream('10.0.0.2');
  const b = new MemoryStream('10.0.0.1');
  a.peer = b;
  b.peer = a;
  return [a, b];
};

const identity = (name: string, platform = 'android'): LocalIdentity => {
  const secretKey = generateIdentitySecret();
  const publicKey = spkiFromSecret(secretKey);
  return {
    id: deviceIdFromPublicKey(publicKey),
    name,
    os: 'Android 15',
    platform,
    publicKey,
    secretKey,
  };
};

const policy = (
  host: LocalIdentity,
  over: Partial<HostPolicy> = {},
): HostPolicy & { sessions: NewSession[] } => {
  const sessions: NewSession[] = [];
  return {
    sessions,
    identity: () => host,
    attended: () => true,
    unattended: () => null,
    busy: () => false,
    isBlocked: () => false,
    retryAfter: () => 0,
    failure: () => undefined,
    success: () => undefined,
    approve: async () => ({ permission: 'control', minutes: 30 }),
    grant: s => {
      sessions.push(s);
      return {
        sessionId: 's1',
        resumeToken: randomToken(),
        permission: s.permission,
        expiresInMs: 60_000,
        extra: { displays: [{ id: 'screen', label: 'Phone' }] },
        onSent: () => undefined,
      };
    },
    resume: () => 'no-session',
    audit: () => undefined,
    ...over,
  };
};

// Denied connections close after a 1 s grace (closeAfter); let those timers run out.
afterAll(() => new Promise<void>(resolve => setTimeout(resolve, 1200)));

describe('bytes', () => {
  it('base64 and UTF-8 match the standard encodings', () => {
    const text = 'héllo → 世界 🎉';
    expect(fromUtf8(utf8(text))).toBe(text);
    // 'é' is C3 A9, '🎉' is F0 9F 8E 89 in UTF-8.
    expect(Array.from(utf8('é🎉'))).toEqual([
      0xc3, 0xa9, 0xf0, 0x9f, 0x8e, 0x89,
    ]);
    expect(toBase64(utf8('hello'))).toBe('aGVsbG8=');
    expect(toBase64(utf8('hi'))).toBe('aGk=');
    expect(fromUtf8(fromBase64('aGVsbG8='))).toBe('hello');
    for (const len of [0, 1, 2, 3, 31, 32, 33]) {
      const data = randomToken(len || 1).slice(0, len);
      expect(Array.from(fromBase64(toBase64(data)))).toEqual(Array.from(data));
    }
  });
});

describe('handshake phone ↔ phone', () => {
  it('attended request: pending with the same code on both sides, then granted', async () => {
    const host = identity('Pixel host');
    const client = identity('Pixel client');
    const p = policy(host);
    let hostCode = '';
    p.approve = async req => {
      hostCode = req.verificationCode;
      return { permission: 'control', minutes: 15 };
    };
    const [a, b] = pair();
    void runHostHandshake(b, p);
    let clientCode = '';
    const result = await runClientHandshake(a, {
      identity: client,
      purpose: 'connect',
      expectedId: host.id,
      onPending: info => {
        clientCode = info.verificationCode;
      },
    });
    expect(clientCode).toMatch(/^\d{3} \d{3}$/);
    expect(clientCode).toBe(hostCode);
    expect(result.granted?.permission).toBe('control');
    expect(result.host.platform).toBe('android');
    expect(p.sessions[0]?.peer.id).toBe(client.id);
  });

  it('a view-only request stays view-only', async () => {
    const host = identity('h');
    const p = policy(host);
    const [a, b] = pair();
    void runHostHandshake(b, p);
    const result = await runClientHandshake(a, {
      identity: identity('c'),
      purpose: 'connect',
      requestPermission: 'view',
    });
    expect(result.granted?.permission).toBe('view');
  });

  it('wrong ID is refused before anything is sent', async () => {
    const [a, b] = pair();
    void runHostHandshake(b, policy(identity('h')));
    await expect(
      runClientHandshake(a, {
        identity: identity('c'),
        purpose: 'connect',
        expectedId: '12345678',
      }),
    ).rejects.toMatchObject({ code: 'identity' });
  });

  it('declined and blocked requests report their codes', async () => {
    const host = identity('h');
    let [a, b] = pair();
    void runHostHandshake(b, policy(host, { approve: async () => null }));
    await expect(
      runClientHandshake(a, { identity: identity('c'), purpose: 'connect' }),
    ).rejects.toMatchObject({ code: 'rejected' });
    [a, b] = pair();
    void runHostHandshake(b, policy(host, { isBlocked: () => true }));
    await expect(
      runClientHandshake(a, { identity: identity('c'), purpose: 'connect' }),
    ).rejects.toMatchObject({ code: 'blocked' });
  });

  it('unattended password: right one granted, wrong one denied', async () => {
    const host = identity('h');
    const salt = randomToken(16);
    const params = { ...MOBILE_HOST_KDF, m: 64, t: 1 }; // small for test speed
    const secret: UnattendedSecret = {
      salt,
      params,
      verifier: await passwordVerifier('Phone-Pass-99', salt, params),
      permission: 'control',
      minutes: 0,
    };
    let [a, b] = pair();
    void runHostHandshake(b, policy(host, { unattended: () => secret }));
    const ok = await runClientHandshake(a, {
      identity: identity('c'),
      purpose: 'connect',
      password: 'Phone-Pass-99',
    });
    expect(ok.granted?.method).toBe('password');
    [a, b] = pair();
    const failures: string[][] = [];
    void runHostHandshake(
      b,
      policy(host, {
        unattended: () => secret,
        failure: keys => failures.push(keys),
      }),
    );
    await expect(
      runClientHandshake(a, {
        identity: identity('c'),
        purpose: 'connect',
        password: 'nope-Nope-1',
      }),
    ).rejects.toMatchObject({ code: 'wrong-password' });
    expect(failures).toHaveLength(1);
  });
});

describe('channel', () => {
  it('encrypts both ways and closes on a tampered frame', async () => {
    const [a, b] = pair();
    const ca = new Channel(a);
    const cb = new Channel(b);
    const k1 = randomToken();
    const k2 = randomToken();
    ca.setKeys(k1, k2);
    cb.setKeys(k2, k1);
    ca.endRawMode();
    cb.endRawMode();
    ca.send({ t: 'hello', n: 1 });
    expect((await cb.receive(1000)).msg).toEqual({ t: 'hello', n: 1 });
    cb.send({ t: 'back' });
    expect((await ca.receive(1000)).msg.t).toBe('back');

    // Corrupt the next frame on the wire.
    const write = a.write.bind(a);
    a.write = bytes => {
      const copy = bytes.slice();
      copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 1;
      write(copy);
    };
    const closed = new Promise<string>(resolve => cb.onClose(resolve));
    ca.send({ t: 'evil' });
    expect(await closed).toMatch(/integrity/);
  });
});
