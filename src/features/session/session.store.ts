import { storage, StorageKeys } from '@/store/mmkv';
import type { Session } from './session.types';

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();

function notify(session: Session | null) {
  for (const l of listeners) l(session);
}

// Synchronous, MMKV-backed session singleton. Non-React callers (the API
// client's token provider) read it directly;
// components subscribe through `useSession`.
export const sessionStore = {
  read(): Session | null {
    const raw = storage.getString(StorageKeys.Session);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  },
  write(session: Session): void {
    storage.set(StorageKeys.Session, JSON.stringify(session));
    notify(session);
  },
  // Shallow-merges a patch into the persisted user. No-ops when signed out.
  patchUser(patch: Partial<Session['user']>): void {
    const current = sessionStore.read();
    if (!current) return;
    sessionStore.write({ ...current, user: { ...current.user, ...patch } });
  },
  clear(): void {
    storage.delete(StorageKeys.Session);
    notify(null);
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
