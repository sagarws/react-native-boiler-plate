import { useEffect, useState } from 'react';
import { sessionStore } from './session.store';
import type { Session } from './session.types';

export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(() => sessionStore.read());
  useEffect(() => sessionStore.subscribe(setSession), []);
  return session;
}
