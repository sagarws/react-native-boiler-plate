import { createLocalId } from '@/shared/utils';
import type { IconName } from '@/shared/assets';
import { icons } from '@/shared/assets';
import { CATEGORY_COLORS, type CategoryColor } from '@/theme';
import { storage, StorageKeys } from '@/store/mmkv';
import { cleanText, isUpiId } from '../services/upi';
import { MAX_AMOUNT } from '../utils/money';
import {
  DEFAULT_CATEGORIES,
  OTHER_CATEGORY_ID,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  type CategoryInput,
  type Expense,
  type ExpenseCategory,
  type ExpenseData,
  type ExpenseInput,
  type ExpenseSettings,
  type TransactionStatus,
} from '../types';

/**
 * Expense Tracker persistence (MMKV, private to this device) — the app's
 * existing local database. Two "tables", `expenses` and
 * `expense_categories`, each under its own key, plus settings and a schema
 * version under `expense.meta`.
 *
 * Every record is validated on load (a bad one is dropped, never crashes
 * the app). Migrations only ever add: the built-in categories are merged in
 * by id, user rows are kept as they are, and no other feature's key is read
 * or written. All writes go through here and notify subscribers.
 */

export const SCHEMA_VERSION = 1;
export const MAX_DESCRIPTION = 200;
export const MAX_CATEGORY_NAME = 40;
export const MAX_MERCHANT = 100;

const KEYS = {
  meta: StorageKeys.ExpenseMeta,
  expenses: StorageKeys.ExpenseRecords,
  categories: StorageKeys.ExpenseCategories,
  settings: StorageKeys.ExpenseSettings,
} as const;

export type ExpenseError =
  | 'amount_invalid'
  | 'category_missing'
  | 'date_invalid'
  | 'name_required'
  | 'name_taken'
  | 'default_category'
  | 'not_found'
  | 'budget_invalid';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExpenseError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: ExpenseError): Result<T> => ({ ok: false, error });

// ── Validation on load ─────────────────────────────────────────────────

type R = Record<string, unknown>;
const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const iso = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '';
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;
const isAmount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_AMOUNT;
const isIcon = (v: unknown): v is IconName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(icons, v);
const EPOCH = new Date(0).toISOString();

function cleanExpense(r: R): Expense | null {
  const transactionDate = iso(r.transactionDate);
  if (typeof r.id !== 'string' || !isAmount(r.amount) || !transactionDate)
    return null;
  const upiId = str(r.merchantUpiId, 256);
  return {
    id: r.id,
    amount: r.amount,
    categoryId: str(r.categoryId, 60) || OTHER_CATEGORY_ID,
    description: str(r.description, MAX_DESCRIPTION),
    merchantName: str(r.merchantName, MAX_MERCHANT),
    merchantUpiId: isUpiId(upiId) ? upiId : '',
    paymentMethod: oneOf(r.paymentMethod, PAYMENT_METHODS, 'other'),
    status: oneOf(r.status, TRANSACTION_STATUSES, 'pending'),
    transactionDate,
    createdAt: iso(r.createdAt) || EPOCH,
    updatedAt: iso(r.updatedAt) || EPOCH,
  };
}

function cleanCategory(r: R): ExpenseCategory | null {
  if (typeof r.id !== 'string' || !r.id) return null;
  const builtIn = DEFAULT_CATEGORIES.find(d => d.id === r.id);
  if (builtIn) {
    return {
      id: builtIn.id,
      name: '',
      icon: builtIn.icon,
      color: builtIn.color,
      isDefault: true,
      createdAt: iso(r.createdAt) || EPOCH,
    };
  }
  const name = str(r.name, MAX_CATEGORY_NAME).trim();
  if (!name) return null;
  return {
    id: r.id,
    name,
    icon: isIcon(r.icon) ? r.icon : 'tag',
    color: oneOf<CategoryColor>(r.color, CATEGORY_COLORS, 'slate'),
    isDefault: false,
    createdAt: iso(r.createdAt) || EPOCH,
  };
}

function readJson(key: string): unknown {
  const raw = storage.getString(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function list<T>(key: string, clean: (r: R) => T | null): T[] {
  const raw = readJson(key);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is R => !!r && typeof r === 'object')
    .map(clean)
    .filter((x): x is T => x !== null);
}

/** Built-ins first (in their fixed order), then custom ones as created. */
function withDefaults(saved: ExpenseCategory[]): ExpenseCategory[] {
  const now = new Date().toISOString();
  const defaults = DEFAULT_CATEGORIES.map(
    d =>
      saved.find(c => c.id === d.id) ?? {
        id: d.id,
        name: '',
        icon: d.icon,
        color: d.color,
        isDefault: true,
        createdAt: now,
      },
  );
  const seen = new Set<string>();
  const custom = saved.filter(
    c => !c.isDefault && !seen.has(c.id) && seen.add(c.id),
  );
  return [...defaults, ...custom];
}

function load(): ExpenseData {
  const meta = readJson(KEYS.meta) as { schemaVersion?: number } | undefined;
  const savedCategories = list(KEYS.categories, cleanCategory);
  const categories = withDefaults(savedCategories);
  const s = (readJson(KEYS.settings) ?? {}) as R;
  const settings: ExpenseSettings = {
    monthlyBudget: isAmount(s.monthlyBudget) ? s.monthlyBudget : null,
    awaitingConfirmationId: str(s.awaitingConfirmationId, 60),
  };
  const ids = new Set(categories.map(c => c.id));
  const expenses = list(KEYS.expenses, cleanExpense).map(e =>
    ids.has(e.categoryId) ? e : { ...e, categoryId: OTHER_CATEGORY_ID },
  );

  // Migration: first run (or an older schema) seeds the built-in categories.
  // Only this feature's own keys are written.
  if (
    meta?.schemaVersion !== SCHEMA_VERSION ||
    savedCategories.length !== categories.length
  ) {
    storage.set(KEYS.categories, JSON.stringify(categories));
    storage.set(KEYS.meta, JSON.stringify({ schemaVersion: SCHEMA_VERSION }));
  }
  return { expenses, categories, settings, version: 0 };
}

// ── Store ──────────────────────────────────────────────────────────────

let cache: ExpenseData | null = null;
const listeners = new Set<() => void>();

const read = (): ExpenseData => (cache ??= load());

function commit(patch: Partial<Omit<ExpenseData, 'version'>>) {
  const current = read();
  if (patch.expenses)
    storage.set(KEYS.expenses, JSON.stringify(patch.expenses));
  if (patch.categories)
    storage.set(KEYS.categories, JSON.stringify(patch.categories));
  if (patch.settings)
    storage.set(KEYS.settings, JSON.stringify(patch.settings));
  cache = { ...current, ...patch, version: current.version + 1 };
  listeners.forEach(listener => listener());
}

function validInput(
  input: ExpenseInput,
  data: ExpenseData,
): Result<Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>> {
  if (!isAmount(input.amount)) return fail('amount_invalid');
  if (!data.categories.some(c => c.id === input.categoryId))
    return fail('category_missing');
  if (!iso(input.transactionDate)) return fail('date_invalid');
  const upiId = (input.merchantUpiId ?? '').trim();
  return ok({
    amount: input.amount,
    categoryId: input.categoryId,
    description: cleanText(input.description, MAX_DESCRIPTION),
    merchantName: cleanText(input.merchantName ?? '', MAX_MERCHANT),
    merchantUpiId: isUpiId(upiId) ? upiId : '',
    paymentMethod: oneOf(input.paymentMethod, PAYMENT_METHODS, 'other'),
    status: oneOf(input.status, TRANSACTION_STATUSES, 'pending'),
    transactionDate: new Date(input.transactionDate).toISOString(),
  });
}

export const expenseStore = {
  read,

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  find(id: string): Expense | undefined {
    return read().expenses.find(e => e.id === id);
  },

  createExpense(input: ExpenseInput): Result<Expense> {
    const data = read();
    const valid = validInput(input, data);
    if (!valid.ok) return fail(valid.error);
    const now = new Date().toISOString();
    const expense: Expense = {
      id: createLocalId(),
      ...valid.value,
      createdAt: now,
      updatedAt: now,
    };
    commit({ expenses: [expense, ...data.expenses] });
    return ok(expense);
  },

  updateExpense(id: string, input: ExpenseInput): Result<Expense> {
    const data = read();
    const current = data.expenses.find(e => e.id === id);
    if (!current) return fail('not_found');
    const valid = validInput(
      {
        ...input,
        merchantName: input.merchantName ?? current.merchantName,
        merchantUpiId: input.merchantUpiId ?? current.merchantUpiId,
      },
      data,
    );
    if (!valid.ok) return fail(valid.error);
    const next: Expense = {
      ...current,
      ...valid.value,
      updatedAt: new Date().toISOString(),
    };
    commit({ expenses: data.expenses.map(e => (e.id === id ? next : e)) });
    return ok(next);
  },

  setStatus(id: string, status: TransactionStatus): Result<Expense> {
    const data = read();
    const current = data.expenses.find(e => e.id === id);
    if (!current) return fail('not_found');
    const next = { ...current, status, updatedAt: new Date().toISOString() };
    commit({ expenses: data.expenses.map(e => (e.id === id ? next : e)) });
    return ok(next);
  },

  deleteExpense(id: string): Result<true> {
    const data = read();
    if (!data.expenses.some(e => e.id === id)) return fail('not_found');
    commit({
      expenses: data.expenses.filter(e => e.id !== id),
      ...(data.settings.awaitingConfirmationId === id && {
        settings: { ...data.settings, awaitingConfirmationId: '' },
      }),
    });
    return ok(true);
  },

  /**
   * Adds or edits a custom category. [reservedNames] are names already shown
   * for the built-ins (translated), which the store can't know itself.
   */
  saveCategory(
    input: CategoryInput,
    reservedNames: readonly string[] = [],
  ): Result<ExpenseCategory> {
    const data = read();
    const name = cleanText(input.name, MAX_CATEGORY_NAME);
    if (!name) return fail('name_required');
    const lower = name.toLowerCase();
    const taken =
      reservedNames.some(n => n.trim().toLowerCase() === lower) ||
      data.categories.some(
        c =>
          !c.isDefault && c.id !== input.id && c.name.toLowerCase() === lower,
      );
    if (taken) return fail('name_taken');
    const icon = isIcon(input.icon) ? input.icon : 'tag';
    const color = oneOf<CategoryColor>(input.color, CATEGORY_COLORS, 'slate');

    if (input.id) {
      const current = data.categories.find(c => c.id === input.id);
      if (!current) return fail('not_found');
      if (current.isDefault) return fail('default_category');
      const next = { ...current, name, icon, color };
      commit({
        categories: data.categories.map(c => (c.id === next.id ? next : c)),
      });
      return ok(next);
    }
    const category: ExpenseCategory = {
      id: createLocalId(),
      name,
      icon,
      color,
      isDefault: false,
      createdAt: new Date().toISOString(),
    };
    commit({ categories: [...data.categories, category] });
    return ok(category);
  },

  /** Deletes a custom category; its expenses move to "Other", none are lost. */
  deleteCategory(id: string): Result<{ moved: number }> {
    const data = read();
    const current = data.categories.find(c => c.id === id);
    if (!current) return fail('not_found');
    if (current.isDefault) return fail('default_category');
    let moved = 0;
    const expenses = data.expenses.map(e => {
      if (e.categoryId !== id) return e;
      moved += 1;
      return { ...e, categoryId: OTHER_CATEGORY_ID };
    });
    commit({
      categories: data.categories.filter(c => c.id !== id),
      ...(moved && { expenses }),
    });
    return ok({ moved });
  },

  /** Paise, or null to remove the budget. */
  setBudget(amount: number | null): Result<true> {
    if (amount !== null && !isAmount(amount)) return fail('budget_invalid');
    const data = read();
    commit({ settings: { ...data.settings, monthlyBudget: amount } });
    return ok(true);
  },

  setAwaitingConfirmation(id: string) {
    const data = read();
    if (data.settings.awaitingConfirmationId === id) return;
    commit({ settings: { ...data.settings, awaitingConfirmationId: id } });
  },

  resetCacheForTest() {
    cache = null;
    listeners.clear();
  },
};
