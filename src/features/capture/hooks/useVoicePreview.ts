import { useCallback, useEffect, useRef, useState } from 'react';
import { speechService } from '../services/speech.service';
import type {
  PreviewOutcome,
  SpeechLanguage,
  VoiceInfo,
} from '../capture.types';

export interface UseVoicePreview {
  /** Name of the voice whose sample is playing, if any. */
  playing: string | null;
  /** Why the last preview did not play, until the next preview starts. */
  problem: Exclude<PreviewOutcome, 'ok' | 'stopped'> | null;
  toggle: (voice: VoiceInfo) => void;
  stop: () => void;
}

/**
 * One voice preview at a time. Starting another stops the current one (the
 * engine flushes it and its request resolves 'stopped'); a token makes sure
 * only the latest request updates the UI. Leaving the screen stops it.
 * Independent of reading sessions: the native side refuses ('busy') while
 * one is speaking.
 */
export function useVoicePreview(rate: number, pitch: number): UseVoicePreview {
  const [playing, setPlaying] = useState<string | null>(null);
  const [problem, setProblem] = useState<UseVoicePreview['problem']>(null);
  const token = useRef(0);
  const active = useRef(false);

  const stop = useCallback(() => {
    if (!active.current) return;
    token.current++;
    active.current = false;
    speechService.stop();
    setPlaying(null);
  }, []);

  const toggle = useCallback(
    (voice: VoiceInfo) => {
      if (playing === voice.name) {
        stop();
        return;
      }
      const mine = ++token.current;
      active.current = true;
      setPlaying(voice.name);
      setProblem(null);
      speechService
        .previewVoice(voice.name, voice.language as SpeechLanguage, rate, pitch)
        .then(outcome => {
          if (mine !== token.current) return;
          active.current = false;
          setPlaying(null);
          if (outcome !== 'ok' && outcome !== 'stopped') setProblem(outcome);
        });
    },
    [pitch, playing, rate, stop],
  );

  useEffect(
    () => () => {
      if (active.current) speechService.stop();
      token.current++;
    },
    [],
  );

  return { playing, problem, toggle, stop };
}
