import { argon2id } from '@noble/hashes/argon2.js';
import {
  clearVerifierCache,
  passwordVerifier,
  randomToken,
  setNativeArgon2,
  type NativeArgon2,
} from '../core/crypto';
import { utf8 } from '../core/bytes';

const params = { t: 1, m: 64, p: 1 };
const reference = (password: string, salt: Uint8Array) =>
  argon2id(utf8(password.normalize('NFKC')), salt, { ...params, dkLen: 32 });

afterEach(() => {
  setNativeArgon2(null);
  clearVerifierCache();
});

describe('passwordVerifier', () => {
  it('uses the native Argon2id when there is one, with the normalised password', async () => {
    const salt = randomToken(16);
    const calls: Parameters<NativeArgon2>[] = [];
    setNativeArgon2(async (...args) => {
      calls.push(args);
      return reference('Café-Pass-1', salt);
    });
    const out = await passwordVerifier('Café-Pass-1', salt, params);
    expect(Array.from(out)).toEqual(Array.from(reference('Café-Pass-1', salt)));
    expect(calls).toHaveLength(1);
    expect(Array.from(calls[0]![0])).toEqual(Array.from(utf8('Café-Pass-1')));
    expect(calls[0]![2]).toEqual({ ...params, dkLen: 32 });
  });

  it('falls back to JavaScript when the native one fails or returns junk', async () => {
    const salt = randomToken(16);
    setNativeArgon2(async () => {
      throw new Error('no');
    });
    expect(Array.from(await passwordVerifier('pw-1', salt, params))).toEqual(
      Array.from(reference('pw-1', salt)),
    );
    setNativeArgon2(async () => new Uint8Array(5));
    expect(Array.from(await passwordVerifier('pw-2', salt, params))).toEqual(
      Array.from(reference('pw-2', salt)),
    );
  });

  it('answers a repeat check from memory, but not for another password, salt or setting', async () => {
    const salt = randomToken(16);
    let calls = 0;
    setNativeArgon2(async (pw, s, p) => {
      calls++;
      return argon2id(pw, s, p);
    });
    const first = await passwordVerifier('pw', salt, params);
    first.fill(0); // callers may scrub their copy
    expect(Array.from(await passwordVerifier('pw', salt, params))).toEqual(
      Array.from(reference('pw', salt)),
    );
    expect(calls).toBe(1);
    await passwordVerifier('pw2', salt, params);
    await passwordVerifier('pw', randomToken(16), params);
    await passwordVerifier('pw', salt, { ...params, t: 2 });
    expect(calls).toBe(4);
  });
});
