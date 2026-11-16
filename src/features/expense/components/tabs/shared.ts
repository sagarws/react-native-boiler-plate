import type { CategoryLookup } from '../../hooks/useExpense';
import type { Expense, ExpenseData } from '../../types';

export const EXPENSE_TABS = [
  'overview',
  'add',
  'history',
  'analytics',
] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number];

export interface TabProps {
  data: ExpenseData;
  lookup: CategoryLookup;
  now: Date;
  /** Bottom inset + breathing room for the scroll content. */
  bottomPad: number;
  openExpense: (expense: Expense) => void;
}
