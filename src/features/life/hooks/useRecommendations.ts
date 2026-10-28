import { useCallback, useRef, useState } from 'react';
import { lifeCoachService, type LifeCoachOutcome } from '@/features/capture';
import { lifeStore } from '../store/life.store';
import { nextPeriodStart } from '../services/periods';
import {
  buildPayload,
  historySize,
  localInsights,
  MIN_HISTORY,
  parseRecommendations,
} from '../services/recommendations';
import type { DayKey, Recommendation } from '../types';
import { useLifeData } from './useLife';

/** Minimum gap between Gemini requests (protects against double taps). */
export const AI_COOLDOWN_MS = 15_000;

export type AiState = 'idle' | 'loading' | 'error' | 'cooldown';

/**
 * AI recommendations on request only (never on render). The last result is
 * cached with the data version it came from; suggested target changes are
 * applied only through [accept], after the user reviews them.
 */
export function useRecommendations(today: DayKey, projectId?: string) {
  const data = useLifeData();
  const [state, setState] = useState<AiState>('idle');
  const [error, setError] = useState<LifeCoachOutcome | null>(null);
  const lastRequest = useRef(0);
  const inFlight = useRef(false);

  const history = historySize(data, today, projectId);
  const enough = history >= MIN_HISTORY;
  const cached = data.recommendations;
  const stale = !!cached && cached.dataVersion !== data.version;

  const request = useCallback(async () => {
    if (inFlight.current) return;
    if (Date.now() - lastRequest.current < AI_COOLDOWN_MS) {
      setState('cooldown');
      return;
    }
    inFlight.current = true;
    lastRequest.current = Date.now();
    setState('loading');
    setError(null);
    const snapshot = lifeStore.read();
    const reply = await lifeCoachService.recommend(
      buildPayload(snapshot, today, projectId),
    );
    inFlight.current = false;
    if (reply.outcome !== 'ok') {
      setError(reply.outcome);
      setState('error');
      return;
    }
    const set = parseRecommendations(reply.text, snapshot, snapshot.version);
    if (!set) {
      setError('bad_response');
      setState('error');
      return;
    }
    lifeStore.saveRecommendations(set);
    setState('idle');
  }, [today, projectId]);

  /** Applies an accepted target proposal from the next period; returns that date. */
  const accept = useCallback(
    (rec: Recommendation): DayKey | null => {
      if (!rec.taskId || !rec.proposedTarget) return null;
      const task = lifeStore.read().tasks.find(t => t.id === rec.taskId);
      if (!task) return null;
      const from = nextPeriodStart(task, today);
      const result = lifeStore.changeTarget(task.id, rec.proposedTarget, today);
      return result.ok ? from : null;
    },
    [today],
  );

  return {
    state,
    error,
    enough,
    history,
    needed: MIN_HISTORY,
    cached,
    stale,
    insights: localInsights(data, today, projectId),
    request,
    accept,
  };
}
