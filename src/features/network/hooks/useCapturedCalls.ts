import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { logger } from '@/shared/utils';
import { networkRepository } from '../repository/network.repository';
import type { CallFilter, CallSummary } from '../types';
import { filterCalls } from '../utils/filters';

export const PAGE_SIZE = 50;

export interface CapturedCallsState {
  /** The loaded page(s) of the filtered list. */
  items: CallSummary[];
  /** All stored calls. */
  total: number;
  /** Calls matching the filter + search. */
  matching: number;
  hasMore: boolean;
  loadMore: () => void;
  filter: CallFilter;
  setFilter: (filter: CallFilter) => void;
  query: string;
  setQuery: (query: string) => void;
  /** Ids of every matching call (for "export filtered"). */
  matchingIds: () => string[];
  remove: (ids: string[]) => boolean;
  clearAll: () => boolean;
  /** Re-reads storage (e.g. pull to refresh). */
  refresh: () => void;
}

export function useCallSummaries(): CallSummary[] {
  return useSyncExternalStore(
    networkRepository.subscribe,
    networkRepository.summaries,
  );
}

/**
 * Captured Network Calls list: search, filter and paging over the stored
 * summaries (bodies are only read on the detail screen).
 */
export function useCapturedCalls(): CapturedCallsState {
  const all = useCallSummaries();
  const [filter, setFilterState] = useState<CallFilter>('all');
  const [query, setQueryState] = useState('');
  const [pages, setPages] = useState(1);

  const filtered = useMemo(
    () => filterCalls(all, filter, query),
    [all, filter, query],
  );
  const items = useMemo(
    () => filtered.slice(0, pages * PAGE_SIZE),
    [filtered, pages],
  );

  const setFilter = useCallback((next: CallFilter) => {
    setFilterState(next);
    setPages(1);
  }, []);
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setPages(1);
  }, []);
  const loadMore = useCallback(() => {
    setPages(p => (p * PAGE_SIZE < filtered.length ? p + 1 : p));
  }, [filtered.length]);

  const remove = useCallback((ids: string[]) => {
    try {
      networkRepository.remove(ids);
      return true;
    } catch (error) {
      logger.error('Network Inspector: delete failed', (error as Error)?.name);
      return false;
    }
  }, []);
  const clearAll = useCallback(() => {
    try {
      networkRepository.clear();
      return true;
    } catch (error) {
      logger.error('Network Inspector: clear failed', (error as Error)?.name);
      return false;
    }
  }, []);
  const refresh = useCallback(() => {
    networkRepository.resetCacheForReload();
  }, []);

  return {
    items,
    total: all.length,
    matching: filtered.length,
    hasMore: items.length < filtered.length,
    loadMore,
    filter,
    setFilter,
    query,
    setQuery,
    matchingIds: () => filtered.map(s => s.id),
    remove,
    clearAll,
    refresh,
  };
}
