import { useCallback, useEffect, useState } from 'react';
import { Share } from 'react-native';
import { logger } from '@/shared/utils';
import { screenOcrService } from '../services/screenOcr.service';
import { historyStore } from '../store/history.store';
import { latestResultStore } from '../store/latestResult.store';
import { selectedOrAll, type TextSelection } from '../utils/text';
import type { OcrResult } from '../capture.types';

export type ExtractedSource =
  | { kind: 'history'; id: string }
  | { kind: 'latest' };

type LoadState = 'loading' | 'ready' | 'missing';

export interface UseExtractedText {
  state: LoadState;
  result: OcrResult | null;
  text: string;
  setText: (next: string) => void;
  /** Text differs from what was extracted (or last saved). */
  dirty: boolean;
  /** Copies the selection, or everything when nothing is selected. */
  copy: (selection?: TextSelection | null) => Promise<boolean>;
  share: () => Promise<void>;
  /** Persists edits back to history; no-op for unsaved (latest-only) results. */
  save: () => void;
  clear: () => void;
  remove: () => void;
}

/** Loads one extraction and the actions of the review screen. */
export function useExtractedText(source: ExtractedSource): UseExtractedText {
  const [state, setState] = useState<LoadState>('loading');
  const [result, setResult] = useState<OcrResult | null>(null);
  const [text, setText] = useState('');
  const [baseline, setBaseline] = useState('');

  const sourceKey = source.kind === 'history' ? source.id : 'latest';

  useEffect(() => {
    let cancelled = false;
    const apply = (found: OcrResult | null | undefined) => {
      if (cancelled) return;
      if (!found) {
        setState('missing');
        return;
      }
      // Refined text is what copy, translation and speech used.
      const shown = found.refined ?? found.text;
      setBaseline(shown);
      setResult(found);
      setText(shown);
      setState('ready');
    };

    if (sourceKey !== 'latest') {
      apply(historyStore.find(sourceKey));
    } else {
      const cached = latestResultStore.read();
      if (cached) apply(cached);
      else
        screenOcrService
          .latest()
          .then(found => {
            if (found) latestResultStore.set(found);
            apply(found);
          })
          .catch(error => {
            logger.error('load latest capture failed', error);
            apply(null);
          });
    }
    return () => {
      cancelled = true;
    };
  }, [sourceKey]);

  const copy = useCallback(
    (selection?: TextSelection | null) =>
      screenOcrService.copy(selectedOrAll(text, selection)),
    [text],
  );

  const share = useCallback(async () => {
    if (text.length === 0) return;
    try {
      await Share.share({ message: text });
    } catch (error) {
      logger.error('share failed', error);
    }
  }, [text]);

  const save = useCallback(() => {
    if (result && historyStore.find(result.id))
      historyStore.updateText(result.id, text);
    setBaseline(text);
  }, [result, text]);

  const clear = useCallback(() => setText(''), []);

  const remove = useCallback(() => {
    if (result) historyStore.remove(result.id);
  }, [result]);

  return {
    state,
    result,
    text,
    setText,
    dirty: state === 'ready' && text !== baseline,
    copy,
    share,
    save,
    clear,
    remove,
  };
}
