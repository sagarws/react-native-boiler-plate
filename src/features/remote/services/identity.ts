import { Platform } from 'react-native';
import {
  deviceIdFromPublicKey,
  fingerprintOf,
  generateIdentitySecret,
  spkiFromSecret,
  type LocalIdentity,
} from '../core/crypto';
import {
  loadIdentitySecret,
  saveIdentitySecret,
} from '../store/remoteData.store';
import { remoteSettingsStore } from '../store/remoteSettings.store';

/**
 * This install's identity: an Ed25519 key made on first use and kept in the
 * app's private storage. The 8-digit device ID is derived from it, so it
 * never changes unless the app's data is cleared.
 */

let cached: {
  secret: Uint8Array;
  publicKey: Uint8Array;
  id: string;
  fingerprint: string;
} | null = null;

const keys = () => {
  if (!cached) {
    let secret = loadIdentitySecret();
    if (!secret) {
      secret = generateIdentitySecret();
      saveIdentitySecret(secret);
    }
    const publicKey = spkiFromSecret(secret);
    cached = {
      secret,
      publicKey,
      id: deviceIdFromPublicKey(publicKey),
      fingerprint: fingerprintOf(publicKey),
    };
  }
  return cached;
};

const constants = Platform.constants as Record<string, unknown>;

/** "Pixel 9" / "iPhone". */
export const modelName = (): string => {
  const model = typeof constants.Model === 'string' ? constants.Model : '';
  const brand = typeof constants.Brand === 'string' ? constants.Brand : '';
  if (model)
    return brand && !model.toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand[0]!.toUpperCase()}${brand.slice(1)} ${model}`
      : model;
  return Platform.OS === 'ios' ? 'iPhone' : 'Android phone';
};

/** "Android 15" / "iOS 18.1". */
export const osLabel = (): string =>
  Platform.OS === 'android'
    ? `Android ${
        typeof constants.Release === 'string'
          ? constants.Release
          : Platform.Version
      }`
    : `iOS ${Platform.Version}`;

export const localIdentity = (): LocalIdentity => {
  const k = keys();
  return {
    id: k.id,
    name: remoteSettingsStore.read().deviceName || modelName(),
    os: osLabel(),
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    publicKey: k.publicKey,
    secretKey: k.secret,
  };
};

export const localFingerprint = (): string => keys().fingerprint;
