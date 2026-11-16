import { toDayKey, type DayKey } from '@/shared/utils/dayKey';
import type { Expense, PaymentMethod, TransactionStatus } from '../types';
import { formatInr, toAmountInput } from '../utils/money';

export interface HistoryFilters {
  query: string;
  categoryIds: string[];
  methods: PaymentMethod[];
  statuses: TransactionStatus[];
  /** Inclusive local days; null = open-ended. */
  from: DayKey | null;
  to: DayKey | null;
}

export const EMPTY_FILTERS: HistoryFilters = {
  query: '',
  categoryIds: [],
  methods: [],
  statuses: [],
  from: null,
  to: null,
};

/** Number of filters set (search not included — it has its own field). */
export function countActiveFilters(f: HistoryFilters): number {
  return (
    (f.categoryIds.length ? 1 : 0) +
    (f.methods.length ? 1 : 0) +
    (f.statuses.length ? 1 : 0) +
    (f.from || f.to ? 1 : 0)
  );
}

/**
 * Transactions matching [f], newest first. The search looks at the
 * description, merchant name, UPI ID, category name and amount.
 */
export function applyFilters(
  expenses: readonly Expense[],
  f: HistoryFilters,
  categoryName: (id: string) => string,
): Expense[] {
  const q = f.query.trim().toLowerCase();
  return expenses
    .filter(e => {
      if (f.categoryIds.length && !f.categoryIds.includes(e.categoryId))
        return false;
      if (f.methods.length && !f.methods.includes(e.paymentMethod))
        return false;
      if (f.statuses.length && !f.statuses.includes(e.status)) return false;
      if (f.from || f.to) {
        const day = toDayKey(new Date(e.transactionDate));
        if (f.from && day < f.from) return false;
        if (f.to && day > f.to) return false;
      }
      if (!q) return true;
      return [
        e.description,
        e.merchantName,
        e.merchantUpiId,
        categoryName(e.categoryId),
        toAmountInput(e.amount),
        formatInr(e.amount),
      ].some(field => field.toLowerCase().includes(q));
    })
    .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
}
