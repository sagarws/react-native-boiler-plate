import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { expenseStore, type ExpenseError } from '../store/expense.store';
import type { ExpenseCategory, ExpenseData } from '../types';

/** All Expense Tracker records, re-rendering on every change. */
export function useExpenseData(): ExpenseData {
  return useSyncExternalStore(expenseStore.subscribe, expenseStore.read);
}

/** Store mutations for screens (the hook layer between UI and persistence). */
export const expenseActions = {
  createExpense: expenseStore.createExpense,
  updateExpense: expenseStore.updateExpense,
  setStatus: expenseStore.setStatus,
  deleteExpense: expenseStore.deleteExpense,
  saveCategory: expenseStore.saveCategory,
  deleteCategory: expenseStore.deleteCategory,
  setBudget: expenseStore.setBudget,
};

export interface CategoryLookup {
  /** Display name: translated for built-ins, as typed for custom ones. */
  nameOf: (category: ExpenseCategory) => string;
  /** By id; unknown ids fall back to "Other". */
  get: (id: string) => ExpenseCategory;
  nameById: (id: string) => string;
  /** Names of the built-ins, so a custom one can't duplicate them. */
  reservedNames: string[];
}

export function useCategories(categories: ExpenseCategory[]): CategoryLookup {
  const { t } = useTranslation();
  const nameOf = useCallback(
    (c: ExpenseCategory) =>
      c.isDefault ? t(`expense.cat_${c.id}` as 'expense.cat_other') : c.name,
    [t],
  );
  return useMemo(() => {
    const byId = new Map(categories.map(c => [c.id, c]));
    const other = byId.get('other') ?? categories[0];
    const get = (id: string) => byId.get(id) ?? other;
    return {
      nameOf,
      get,
      nameById: (id: string) => nameOf(get(id)),
      reservedNames: categories.filter(c => c.isDefault).map(nameOf),
    };
  }, [categories, nameOf]);
}

/** A store error as a message for the user. */
export function useExpenseErrorText(): (error: ExpenseError) => string {
  const { t } = useTranslation();
  return useCallback(error => t(`expense.error_${error}`), [t]);
}
