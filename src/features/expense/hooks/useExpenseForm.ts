import { useCallback, useState } from 'react';
import { instantOf, parseTime, timeOf } from '@/features/followup';
import { toDayKey, type DayKey } from '@/shared/utils/dayKey';
import type { ExpenseError, Result } from '../store/expense.store';
import { expenseActions } from './useExpense';
import type {
  Expense,
  ExpenseInput,
  PaymentMethod,
  TransactionStatus,
} from '../types';
import { parseAmount, toAmountInput } from '../utils/money';

export interface ExpenseDraft {
  amount: string;
  categoryId: string;
  description: string;
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  day: DayKey;
  /** "HH:MM" as typed. */
  time: string;
}

export type DraftError = 'amount' | 'time' | 'future';

export function emptyDraft(now: Date = new Date()): ExpenseDraft {
  return {
    amount: '',
    categoryId: 'food',
    description: '',
    paymentMethod: 'upi',
    status: 'paid',
    day: toDayKey(now),
    time: timeOf(now),
  };
}

export function draftOf(e: Expense): ExpenseDraft {
  const at = new Date(e.transactionDate);
  return {
    amount: toAmountInput(e.amount),
    categoryId: e.categoryId,
    description: e.description,
    paymentMethod: e.paymentMethod,
    status: e.status,
    day: toDayKey(at),
    time: timeOf(at),
  };
}

/** Field problems in [d], in the order they're shown. */
export function draftErrors(d: ExpenseDraft, now: Date): DraftError[] {
  const errors: DraftError[] = [];
  if (parseAmount(d.amount) === null) errors.push('amount');
  const time = parseTime(d.time);
  if (!time) errors.push('time');
  // A minute of slack so "now" never counts as the future.
  else if (instantOf(d.day, time).getTime() > now.getTime() + 60_000)
    errors.push('future');
  return errors;
}

/** The draft as store input; null when it doesn't validate. */
export function toInput(d: ExpenseDraft, now: Date): ExpenseInput | null {
  const amount = parseAmount(d.amount);
  const time = parseTime(d.time);
  if (amount === null || !time || draftErrors(d, now).length) return null;
  return {
    amount,
    categoryId: d.categoryId,
    description: d.description,
    paymentMethod: d.paymentMethod,
    status: d.status,
    transactionDate: instantOf(d.day, time).toISOString(),
  };
}

export interface ExpenseForm {
  draft: ExpenseDraft;
  set: (patch: Partial<ExpenseDraft>) => void;
  /** Field errors — shown only after a save was attempted. */
  errors: DraftError[];
  storeError: ExpenseError | null;
  /** Creates (no [editing]) or updates the expense. */
  save: () => Result<Expense> | null;
  reset: () => void;
}

/**
 * Add / edit expense form state. Validation runs on save; after a failed
 * attempt the errors update as the user types.
 */
export function useExpenseForm(editing?: Expense): ExpenseForm {
  const [draft, setDraft] = useState<ExpenseDraft>(() =>
    editing ? draftOf(editing) : emptyDraft(),
  );
  const [attempted, setAttempted] = useState(false);
  const [storeError, setStoreError] = useState<ExpenseError | null>(null);

  const set = useCallback((patch: Partial<ExpenseDraft>) => {
    setDraft(d => ({ ...d, ...patch }));
    setStoreError(null);
  }, []);

  const save = () => {
    setAttempted(true);
    const input = toInput(draft, new Date());
    if (!input) return null;
    const result = editing
      ? expenseActions.updateExpense(editing.id, input)
      : expenseActions.createExpense(input);
    setStoreError(result.ok ? null : result.error);
    return result;
  };

  const reset = () => {
    setDraft(d => ({
      ...emptyDraft(),
      categoryId: d.categoryId,
      paymentMethod: d.paymentMethod,
    }));
    setAttempted(false);
    setStoreError(null);
  };

  return {
    draft,
    set,
    errors: attempted ? draftErrors(draft, new Date()) : [],
    storeError,
    save,
    reset,
  };
}
