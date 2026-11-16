import { useMemo, useState } from 'react';
import {
  applyFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  type HistoryFilters,
} from '../services/filters';
import type { Expense } from '../types';

export interface History {
  filters: HistoryFilters;
  setFilters: (next: HistoryFilters) => void;
  results: Expense[];
  /** Paise across the results that were paid. */
  paidTotal: number;
  activeFilters: number;
}

/** Transaction history with search and filters (screen state, not stored). */
export function useHistory(
  expenses: Expense[],
  categoryName: (id: string) => string,
  initial: Partial<HistoryFilters> = {},
): History {
  const [filters, setFilters] = useState<HistoryFilters>({
    ...EMPTY_FILTERS,
    ...initial,
  });
  const results = useMemo(
    () => applyFilters(expenses, filters, categoryName),
    [expenses, filters, categoryName],
  );
  const paidTotal = useMemo(
    () => results.reduce((s, e) => (e.status === 'paid' ? s + e.amount : s), 0),
    [results],
  );
  return {
    filters,
    setFilters,
    results,
    paidTotal,
    activeFilters: countActiveFilters(filters),
  };
}
