import { storage, StorageKeys } from '@/store/mmkv';
import { parseDeviceId } from '../core/ids';

/*
 * Other devices' unattended passwords, so reconnecting does not mean typing
 * them again. Only ever stored sealed (AES-GCM, key in the Android Keystore);
 * where that is not available nothing is saved. MMKV holds
 * { [deviceId]: { sealed, at } }.
 */

export interface SecretBox {
  available: boolean;
  seal(plain: string): Promise<string>;
  open(sealed: string): Promise<string>;
}

interface Entry {
  sealed: string;
  at: number;
}

const MAX_SAVED = 50;

const read = (): Record<string, Entry> => {
  try {
    const raw = JSON.parse(
      storage.getString(StorageKeys.RemoteSavedPasswords) ?? '{}',
    ) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, Entry> = {};
    for (const [key, value] of Object.entries(raw)) {
      const id = parseDeviceId(key);
      const v = value as Record<string, unknown> | null;
      if (
        id &&
        v &&
        typeof v.sealed === 'string' &&
        v.sealed.length < 2048 &&
        typeof v.at === 'number'
      )
        out[id] = { sealed: v.sealed, at: v.at };
    }
    return out;
  } catch {
    return {};
  }
};

const write = (entries: Record<string, Entry>): void => {
  const newest = Object.entries(entries)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_SAVED);
  if (newest.length)
    storage.set(
      StorageKeys.RemoteSavedPasswords,
      JSON.stringify(Object.fromEntries(newest)),
    );
  else storage.delete(StorageKeys.RemoteSavedPasswords);
};

export class SavedPasswords {
  constructor(private readonly box: SecretBox) {}

  get available(): boolean {
    return this.box.available;
  }

  /** Device IDs that have a saved password, newest first. */
  ids(): string[] {
    return Object.entries(read())
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id]) => id);
  }

  has(id: string): boolean {
    const key = parseDeviceId(id);
    return !!key && key in read();
  }

  /** The saved password, or null (none, or it can no longer be opened — then it is dropped). */
  async get(id: string): Promise<string | null> {
    const key = parseDeviceId(id);
    const entry = key ? read()[key] : undefined;
    if (!key || !entry || !this.box.available) return null;
    try {
      return await this.box.open(entry.sealed);
    } catch {
      this.forget(key);
      return null;
    }
  }

  /** Saves (or refreshes) a password. False when it cannot be kept encrypted. */
  async save(id: string, password: string): Promise<boolean> {
    const key = parseDeviceId(id);
    if (!key || !password || password.length > 256 || !this.box.available)
      return false;
    try {
      const sealed = await this.box.seal(password);
      write({ ...read(), [key]: { sealed, at: Date.now() } });
      return true;
    } catch {
      return false;
    }
  }

  forget(id: string): void {
    const key = parseDeviceId(id);
    if (!key) return;
    const entries = read();
    if (!(key in entries)) return;
    delete entries[key];
    write(entries);
  }

  forgetAll(): void {
    storage.delete(StorageKeys.RemoteSavedPasswords);
  }
}
