import { useCallback, useEffect, useRef, useState } from 'react';
import {
  translateService,
  type GeminiKeyStatus,
  type GeminiModelInfo,
  type GeminiReport,
} from '../services/translate.service';

export interface UseGeminiKey {
  status: GeminiKeyStatus;
  /** Saves the key; resolves whether it was stored. The caller should clear its input. */
  save: (apiKey: string) => Promise<boolean>;
  remove: () => void;
  /** Lists available models, then sends a test translation. */
  test: () => Promise<GeminiReport>;
  testing: boolean;
  /** Models the key can call (filled by Test connection). */
  models: GeminiModelInfo[];
}

/** Saved-key status and actions. The key itself never enters React state here. */
export function useGeminiKey(): UseGeminiKey {
  const [status, setStatus] = useState<GeminiKeyStatus>({
    hasKey: false,
    hint: '',
  });
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<GeminiModelInfo[]>([]);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await translateService.getKeyStatus();
    if (mounted.current) setStatus(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const save = useCallback(
    async (apiKey: string) => {
      const ok = await translateService.saveKey(apiKey);
      await refresh();
      return ok;
    },
    [refresh],
  );

  const remove = useCallback(() => {
    translateService.clearKey();
    setStatus({ hasKey: false, hint: '' });
  }, []);

  const test = useCallback(async () => {
    setTesting(true);
    const listed = await translateService.listModels();
    if (mounted.current) setModels(listed.models);
    // A key that can't even list models fails the same way for translation.
    const report =
      listed.report.outcome === 'ok'
        ? await translateService.test()
        : listed.report;
    if (mounted.current) setTesting(false);
    return report;
  }, []);

  return { status, save, remove, test, testing, models };
}
