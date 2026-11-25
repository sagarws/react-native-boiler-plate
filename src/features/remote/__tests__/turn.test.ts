import { utf8 } from '../core/bytes';
import { dialThroughRelay, parseIceGrant, type IceGrant } from '../core/relay';
import { ByteStream } from '../core/stream';
import { iceServersFor } from '../services/rtc';
import { DEFAULT_REMOTE_SETTINGS } from '../store/remoteSettings.store';

const grant = (over: Partial<IceGrant> = {}): IceGrant => ({
  urls: ['turn:203.0.113.9:3478?transport=udp'],
  username: '1900000000:featured',
  credential: 'abc=',
  expiresAt: Date.now() + 3_600_000,
  ...over,
});

describe('TURN logins from the relay', () => {
  it('accepts only a well-formed login', () => {
    expect(parseIceGrant(grant())).toEqual(
      grant({ expiresAt: expect.any(Number) as never }),
    );
    expect(parseIceGrant(undefined)).toBeNull();
    expect(parseIceGrant({ ...grant(), urls: ['http://evil'] })).toBeNull();
    expect(parseIceGrant({ ...grant(), credential: 1 })).toBeNull();
    expect(parseIceGrant({ ...grant(), username: 'x'.repeat(200) })).toBeNull();
  });
});

/** A relay that has already said "nonce" and "ready" (with `ready`'s extras). */
class FakeRelay extends ByteStream {
  readonly remoteAddress = 'relay';
  constructor(ready: Record<string, unknown>) {
    super();
    setTimeout(
      () =>
        this.received(
          utf8(
            `${JSON.stringify({ op: 'nonce', nonce: '' })}\n${JSON.stringify({
              op: 'ready',
              ...ready,
            })}\n`,
          ),
        ),
      0,
    );
  }
  write(): void {}
  end(): void {
    this.destroy();
  }
  destroy(): void {
    this.finished('closed');
  }
}

describe('iceServersFor', () => {
  it('uses STUN, plus the relay TURN login while it is valid', () => {
    const base = iceServersFor(DEFAULT_REMOTE_SETTINGS);
    expect(
      base.some(s => [s.urls].flat().some(u => u.startsWith('turn:'))),
    ).toBe(false);
    expect(base[0]?.urls).toContain('stun:stun.cloudflare.com:3478');
  });

  it('adds the TURN login the relay sent with "ready", and drops it once expired', async () => {
    const turnUrls = (servers: ReturnType<typeof iceServersFor>) =>
      servers.filter(s => [s.urls].flat().some(u => u.startsWith('turn:')));
    const fresh = grant();
    const stream = await dialThroughRelay(
      async () => new FakeRelay({ ice: fresh }),
      '12345678',
    );
    stream.destroy();
    expect(turnUrls(iceServersFor(DEFAULT_REMOTE_SETTINGS))).toEqual([
      {
        urls: fresh.urls,
        username: fresh.username,
        credential: fresh.credential,
      },
    ]);
    const stale = grant({ expiresAt: Date.now() + 10_000 });
    (
      await dialThroughRelay(
        async () => new FakeRelay({ ice: stale }),
        '12345678',
      )
    ).destroy();
    expect(turnUrls(iceServersFor(DEFAULT_REMOTE_SETTINGS))).toEqual([]);
  });

  it('a phone setting overrides everything', () => {
    const servers = iceServersFor({
      ...DEFAULT_REMOTE_SETTINGS,
      turnUrl: 'turn:my.example:3478',
      turnUsername: 'me',
      turnCredential: 'pw',
    });
    expect(servers).toEqual([
      { urls: 'turn:my.example:3478', username: 'me', credential: 'pw' },
    ]);
  });
});
