import { useCallback, useEffect, useRef, useState } from 'react';
import type { NoticeTone } from '@/shared/components';

export interface Flash {
  message: string;
  tone: NoticeTone;
}

/** A short-lived confirmation ("Copied", "Deleted") shown as a Notice. */
export function useFlash(durationMs = 2500) {
  const [flash, setFlash] = useState<Flash | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(
    (message: string, tone: NoticeTone = 'success') => {
      if (timer.current) clearTimeout(timer.current);
      setFlash({ message, tone });
      timer.current = setTimeout(() => setFlash(null), durationMs);
    },
    [durationMs],
  );
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setFlash(null);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { flash, show, dismiss };
}
