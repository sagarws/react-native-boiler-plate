import { useCallback, useEffect, useRef, useState } from 'react';
import { googleAccountService } from '../services/googleAccount.service';
import type { ConnectOutcome, GoogleAccount } from '../types';

export interface UseGoogleAccount {
  account: GoogleAccount | null;
  /** False until the previous sign-in (if any) has been restored. */
  ready: boolean;
  busy: boolean;
  connect: () => Promise<ConnectOutcome>;
  disconnect: () => Promise<void>;
  /** The account was found signed out (e.g. Drive rejected its token). */
  markDisconnected: () => void;
}

/** The Google account File Management uses, restored silently on mount. */
export function useGoogleAccount(): UseGoogleAccount {
  const [account, setAccount] = useState<GoogleAccount | null>(() =>
    googleAccountService.current(),
  );
  const [ready, setReady] = useState(account !== null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!ready) {
      void googleAccountService.restore().then(restored => {
        if (!mounted.current) return;
        setAccount(restored);
        setReady(true);
      });
    }
    return () => {
      mounted.current = false;
    };
    // Restore once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    const outcome = await googleAccountService.connect();
    if (mounted.current) {
      if (outcome.ok) setAccount(outcome.account);
      setBusy(false);
    }
    return outcome;
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    await googleAccountService.disconnect();
    if (mounted.current) {
      setAccount(null);
      setBusy(false);
    }
  }, []);

  const markDisconnected = useCallback(() => setAccount(null), []);

  return { account, ready, busy, connect, disconnect, markDisconnected };
}
