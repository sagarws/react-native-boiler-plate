import { addDays, toDayKey, type DayKey } from '@/shared/utils/dayKey';
import type { Expense, PaymentMethod } from '../types';

/**
 * Spending numbers for the dashboard and analytics. Only `paid` expenses
 * count as money spent; pending payments are reported separately and failed
 * ones are left out.
 */

const dayOf = (e: Expense): DayKey => toDayKey(new Date(e.transactionDate));
const monthOf = (day: DayKey) => day.slice(0, 7);
const paid = (expenses: readonly Expense[]) =>
  expenses.filter(e => e.status === 'paid');
const sum = (expenses: readonly Expense[]) =>
  expenses.reduce((total, e) => total + e.amount, 0);

export interface ExpenseSummary {
  /** Paise spent today. */
  today: number;
  /** Paise spent this calendar month. */
  month: number;
  /** Transactions this month, any status. */
  monthCount: number;
  pendingCount: number;
  pendingAmount: number;
}

export function summarize(
  expenses: readonly Expense[],
  now: Date,
): ExpenseSummary {
  const today = toDayKey(now);
  const month = monthOf(today);
  const inMonth = expenses.filter(e => monthOf(dayOf(e)) === month);
  const pending = expenses.filter(e => e.status === 'pending');
  return {
    today: sum(paid(inMonth).filter(e => dayOf(e) === today)),
    month: sum(paid(inMonth)),
    monthCount: inMonth.length,
    pendingCount: pending.length,
    pendingAmount: sum(pending),
  };
}

export interface BudgetState {
  budget: number;
  spent: number;
  /** 0–∞; above 100 when over budget. */
  percent: number;
  /** Paise left (negative when over). */
  remaining: number;
}

export function budgetState(
  budget: number | null,
  spent: number,
): BudgetState | null {
  if (!budget) return null;
  return {
    budget,
    spent,
    percent: Math.round((spent / budget) * 100),
    remaining: budget - spent,
  };
}

export interface SeriesPoint {
  /** First day of the bucket. */
  start: DayKey;
  total: number;
}

function totalsByDay(expenses: readonly Expense[]): Map<DayKey, number> {
  const map = new Map<DayKey, number>();
  for (const e of paid(expenses)) {
    const d = dayOf(e);
    map.set(d, (map.get(d) ?? 0) + e.amount);
  }
  return map;
}

/** The last [days] days, oldest first, ending today. */
export function dailySeries(
  expenses: readonly Expense[],
  now: Date,
  days = 7,
): SeriesPoint[] {
  const byDay = totalsByDay(expenses);
  const today = toDayKey(now);
  return Array.from({ length: days }, (_, i) => {
    const start = addDays(today, i - days + 1);
    return { start, total: byDay.get(start) ?? 0 };
  });
}

/** Monday of [day]'s week. */
export function weekStart(day: DayKey): DayKey {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  return addDays(day, -((weekday + 6) % 7));
}

/** The last [weeks] Monday-to-Sunday weeks, oldest first. */
export function weeklySeries(
  expenses: readonly Expense[],
  now: Date,
  weeks = 8,
): SeriesPoint[] {
  const byDay = totalsByDay(expenses);
  const current = weekStart(toDayKey(now));
  return Array.from({ length: weeks }, (_, i) => {
    const start = addDays(current, (i - weeks + 1) * 7);
    let total = 0;
    for (let d = 0; d < 7; d++) total += byDay.get(addDays(start, d)) ?? 0;
    return { start, total };
  });
}

/** The last [months] calendar months, oldest first. */
export function monthlySeries(
  expenses: readonly Expense[],
  now: Date,
  months = 6,
): SeriesPoint[] {
  const totals = new Map<string, number>();
  for (const e of paid(expenses)) {
    const m = monthOf(dayOf(e));
    totals.set(m, (totals.get(m) ?? 0) + e.amount);
  }
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const start = toDayKey(d);
    return { start, total: totals.get(monthOf(start)) ?? 0 };
  });
}

export interface Breakdown<K extends string> {
  key: K;
  total: number;
  count: number;
}

function breakdown<K extends string>(
  expenses: readonly Expense[],
  keyOf: (e: Expense) => K,
): Breakdown<K>[] {
  const map = new Map<K, Breakdown<K>>();
  for (const e of paid(expenses)) {
    const key = keyOf(e);
    const row = map.get(key) ?? { key, total: 0, count: 0 };
    row.total += e.amount;
    row.count += 1;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export type BreakdownRange = 'month' | 'all';

/** Expenses inside [range] relative to [now]. */
export function inRange(
  expenses: readonly Expense[],
  range: BreakdownRange,
  now: Date,
): Expense[] {
  if (range === 'all') return [...expenses];
  const month = monthOf(toDayKey(now));
  return expenses.filter(e => monthOf(dayOf(e)) === month);
}

export const byCategory = (expenses: readonly Expense[]) =>
  breakdown(expenses, e => e.categoryId);

export const byMethod = (expenses: readonly Expense[]) =>
  breakdown<PaymentMethod>(expenses, e => e.paymentMethod);
