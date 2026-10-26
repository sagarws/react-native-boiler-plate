import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { speechService } from '../services/speech.service';
import type { SpeechInfo } from '../capture.types';

export interface UseSpeechInfo {
  info: SpeechInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

/**
 * The device's TTS engines, voices and per-language status, plus whether the
 * auto-scroll accessibility service is on. Re-read whenever the app returns
 * to the foreground (the user may have installed a voice or changed a
 * setting) and when [preferGoogle] changes the engine.
 */
export function useSpeechInfo(preferGoogle: boolean): UseSpeechInfo {
  const [info, setInfo] = useState<SpeechInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await speechService.getInfo();
    if (!mounted.current) return;
    setInfo(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [refresh, preferGoogle]);

  return { info, loading, refresh };
}
