import { Platform } from 'react-native';
import NativeRemoteControl from '@/specs/NativeRemoteControl';
import { fromBase64, toBase64 } from '../core/bytes';
import { setNativeArgon2 } from '../core/crypto';

/**
 * Null-safe wrapper around the Remote Access native module. On iOS and under
 * Jest the module is absent: discovery falls back to the global broadcast,
 * and this phone cannot be controlled (viewing others still works).
 */

// The password check (Argon2id) natively when the module is there: the
// computer's setting takes about a minute in JavaScript on a phone.
const native = NativeRemoteControl;
if (native)
  setNativeArgon2(async (password, salt, params) =>
    fromBase64(
      await native.argon2id(
        toBase64(password),
        toBase64(salt),
        params.t,
        params.m,
        params.p,
        params.dkLen,
      ),
    ),
  );

export interface NetworkAddress {
  address: string;
  broadcast: string | null;
}

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  rotation: number;
}

const parse = <T>(json: string, fallback: T): T => {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
};

export const remoteNative = {
  /** Can saved passwords be kept encrypted (Android Keystore)? */
  canSealSecrets: Platform.OS === 'android' && NativeRemoteControl !== null,

  async sealSecret(plain: string): Promise<string> {
    if (!NativeRemoteControl) throw new Error('Secure storage unavailable.');
    return NativeRemoteControl.sealSecret(plain);
  },

  async openSecret(sealed: string): Promise<string> {
    if (!NativeRemoteControl) throw new Error('Secure storage unavailable.');
    return NativeRemoteControl.openSecret(sealed);
  },

  /** Can this phone be controlled at all (Android with the native module)? */
  canHost: Platform.OS === 'android' && NativeRemoteControl !== null,

  async networkAddresses(): Promise<NetworkAddress[]> {
    if (!NativeRemoteControl) return [];
    const list = parse<NetworkAddress[]>(
      await NativeRemoteControl.getNetworkAddresses(),
      [],
    );
    return Array.isArray(list)
      ? list.filter(a => typeof a.address === 'string')
      : [];
  },

  setDiscoveryLock(enabled: boolean): void {
    NativeRemoteControl?.setDiscoveryLock(enabled);
  },

  async screenInfo(): Promise<ScreenInfo | null> {
    if (!NativeRemoteControl) return null;
    return parse<ScreenInfo | null>(
      await NativeRemoteControl.getScreenInfo(),
      null,
    );
  },

  setKeepScreenOn(enabled: boolean): void {
    NativeRemoteControl?.setKeepScreenOn(enabled);
  },

  async controlServiceEnabled(): Promise<boolean> {
    return NativeRemoteControl
      ? NativeRemoteControl.isControlServiceEnabled()
      : false;
  },

  openControlServiceSettings(): void {
    NativeRemoteControl?.openControlServiceSettings();
  },

  pointer(
    action: 'down' | 'move' | 'up' | 'cancel',
    x: number,
    y: number,
    button: number,
  ): void {
    NativeRemoteControl?.pointer(action, x, y, button);
  },

  scroll(x: number, y: number, dx: number, dy: number): void {
    NativeRemoteControl?.scroll(x, y, dx, dy);
  },

  globalAction(name: string): Promise<boolean> {
    return NativeRemoteControl
      ? NativeRemoteControl.globalAction(name)
      : Promise.resolve(false);
  },

  typeText(text: string): Promise<boolean> {
    return NativeRemoteControl
      ? NativeRemoteControl.typeText(text)
      : Promise.resolve(false);
  },

  editAction(name: string): Promise<boolean> {
    return NativeRemoteControl
      ? NativeRemoteControl.editAction(name)
      : Promise.resolve(false);
  },

  notifyIncoming(title: string, text: string): void {
    NativeRemoteControl?.notifyIncoming(title, text);
  },

  cancelIncoming(): void {
    NativeRemoteControl?.cancelIncoming();
  },
};
