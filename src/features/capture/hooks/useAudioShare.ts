import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AUDIO_SHARE_OFF,
  audioShareService,
  type AudioShareStatus,
} from '../services/audioShare.service';

const POLL_MS = 1000;

export interface UseAudioShare {
  status: AudioShareStatus;
  approve: () => void;
  deny: () => void;
  disconnect: () => void;
  renewCode: () => void;
  /** Re-reads the status now (e.g. after Retry). */
  refresh: () => void;
}

/** Live audio-sharing status, polled once a second while [active]. */
export function useAudioShare(active: boolean): UseAudioShare {
  const [status, setStatus] = useState<AudioShareStatus>(AUDIO_SHARE_OFF);
  const mounted = useRef(true);

  const refresh = useCallback(() => {
    void audioShareService.getStatus().then(next => {
      if (mounted.current) setStatus(next);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) {
      setStatus(AUDIO_SHARE_OFF);
      return undefined;
    }
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const act = useCallback(
    (fn: () => void) => () => {
      fn();
      refresh();
    },
    [refresh],
  );

  return {
    status,
    approve: act(() => audioShareService.respond(true)),
    deny: act(() => audioShareService.respond(false)),
    disconnect: act(() => audioShareService.disconnect()),
    renewCode: act(() => audioShareService.renewCode()),
    refresh,
  };
}
