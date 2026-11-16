import type { IconName } from '@/shared/assets';
import type { CategoryColor } from '@/theme';
import type { DayKey } from '@/shared/utils/dayKey';

export type { DayKey };

export const PAYMENT_METHODS = [
  'upi',
  'cash',
  'card',
  'netBanking',
  'wallet',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * `paid` only after the user said so. A UPI payment starts `pending` and the
 * user moves it to `paid` / `failed` when they know — never automatically.
 */
export const TRANSACTION_STATUSES = ['paid', 'pending', 'failed'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const METHOD_ICONS: Record<PaymentMethod, IconName> = {
  upi: 'qrCode',
  cash: 'banknote',
  card: 'creditCard',
  netBanking: 'landmark',
  wallet: 'wallet',
  other: 'circleEllipsis',
};

/** Row of the `expense_categories` table. */
export interface ExpenseCategory {
  id: string;
  /** User-given name; '' for a built-in category (its name is translated). */
  name: string;
  icon: IconName;
  color: CategoryColor;
  isDefault: boolean;
  createdAt: string;
}

/** Row of the `expenses` table. */
export interface Expense {
  id: string;
  /** Integer paise (₹1 = 100), so totals never pick up float rounding. */
  amount: number;
  categoryId: string;
  description: string;
  merchantName: string;
  merchantUpiId: string;
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  /** ISO instant the money was spent. */
  transactionDate: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSettings {
  /** Paise; null = no budget set. */
  monthlyBudget: number | null;
  /**
   * The UPI payment the user was sent to pay and hasn't confirmed yet. Kept
   * in storage so the "did it go through?" question survives Android closing
   * the app while the UPI app was in front.
   */
  awaitingConfirmationId: string;
}

export interface ExpenseData {
  expenses: Expense[];
  categories: ExpenseCategory[];
  settings: ExpenseSettings;
  /** Bumped on every write. */
  version: number;
}

export interface ExpenseInput {
  amount: number;
  categoryId: string;
  description: string;
  paymentMethod: PaymentMethod;
  status: TransactionStatus;
  transactionDate: string;
  merchantName?: string;
  merchantUpiId?: string;
}

export interface CategoryInput {
  /** Omit to add a new category. */
  id?: string;
  name: string;
  icon: IconName;
  color: CategoryColor;
}

/** Built-in categories; their names come from `expense.cat_<id>`. */
export const DEFAULT_CATEGORIES: readonly {
  id: string;
  icon: IconName;
  color: CategoryColor;
}[] = [
  { id: 'food', icon: 'utensils', color: 'orange' },
  { id: 'grocery', icon: 'shoppingCart', color: 'emerald' },
  { id: 'shopping', icon: 'shoppingBag', color: 'pink' },
  { id: 'transport', icon: 'car', color: 'blue' },
  { id: 'fuel', icon: 'fuel', color: 'amber' },
  { id: 'medical', icon: 'heartPulse', color: 'rose' },
  { id: 'entertainment', icon: 'clapperboard', color: 'violet' },
  { id: 'bills', icon: 'zap', color: 'indigo' },
  { id: 'education', icon: 'graduationCap', color: 'teal' },
  { id: 'travel', icon: 'plane', color: 'blue' },
  { id: 'personalCare', icon: 'scissors', color: 'pink' },
  { id: 'other', icon: 'circleEllipsis', color: 'slate' },
];

/** Where a deleted custom category's expenses move to. */
export const OTHER_CATEGORY_ID = 'other';

/** Icons offered for custom categories. */
export const CATEGORY_ICONS: readonly IconName[] = [
  'utensils',
  'shoppingCart',
  'shoppingBag',
  'car',
  'fuel',
  'heartPulse',
  'clapperboard',
  'zap',
  'graduationCap',
  'plane',
  'scissors',
  'receipt',
  'wallet',
  'banknote',
  'creditCard',
  'landmark',
  'smartphone',
  'bookOpen',
  'users',
  'cake',
  'sparkles',
  'tag',
  'circleEllipsis',
];
