import { useTranslation } from 'react-i18next';
import type { StatusTone } from '@/shared/components';
import { formatDay } from '@/features/life';
import { timeOf } from '@/features/followup';
import { toDayKey } from '@/shared/utils/dayKey';
import type { PaymentMethod, TransactionStatus } from '../types';

export const STATUS_TONE: Record<TransactionStatus, StatusTone> = {
  paid: 'success',
  pending: 'warning',
  failed: 'error',
};

/** Translated names for the expense enums. */
export function useExpenseLabels() {
  const { t } = useTranslation();
  return {
    method: (m: PaymentMethod) => t(`expense.method_${m}`),
    status: (s: TransactionStatus) => t(`expense.status_${s}`),
  };
}

/** "9 Nov, 14:30" in the device locale. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${formatDay(toDayKey(d))}, ${timeOf(d)}`;
}
