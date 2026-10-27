import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { paginationService } from '../services/pagination.service';
import { screenOcrService } from '../services/screenOcr.service';
import type { PaginationTargetStatus } from '../capture.types';

export interface UsePaginationTarget {
  target: PaginationTargetStatus | null;
  refresh: () => Promise<void>;
  clear: () => void;
}

/**
 * The pinned Next button and whether it still fits the screen. Re-read on
 * return to the app (the user pins it over another app) and when the service
 * reports a change (a pin was saved).
 */
export function usePaginationTarget(): UsePaginationTarget {
  const [target, setTarget] = useState<PaginationTargetStatus | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const next = await paginationService.getTarget();
    if (mounted.current) setTarget(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    const unsubscribe = screenOcrService.onStatus(() => {
      void refresh();
    });
    return () => {
      mounted.current = false;
      sub.remove();
      unsubscribe();
    };
  }, [refresh]);

  const clear = useCallback(() => {
    paginationService.clearTarget();
    setTarget(null);
  }, []);

  return { target, refresh, clear };
}
