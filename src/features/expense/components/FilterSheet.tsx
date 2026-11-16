import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip, ChipRow, Field, Sheet } from '@/features/followup';
import { DateField } from '@/features/life';
import { Button } from '@/shared/components';
import { toDayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import type { CategoryLookup } from '../hooks/useExpense';
import { EMPTY_FILTERS, type HistoryFilters } from '../services/filters';
import {
  METHOD_ICONS,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  type ExpenseCategory,
} from '../types';
import { useExpenseLabels } from './labels';

const toggle = <T,>(list: T[], item: T): T[] =>
  list.includes(item) ? list.filter(x => x !== item) : [...list, item];

/** Category · payment method · status · date range. Applied on "Apply". */
export function FilterSheet({
  visible,
  value,
  onApply,
  onClose,
  categories,
  lookup,
}: {
  visible: boolean;
  value: HistoryFilters;
  onApply: (next: HistoryFilters) => void;
  onClose: () => void;
  categories: ExpenseCategory[];
  lookup: CategoryLookup;
}) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const labels = useExpenseLabels();
  const [draft, setDraft] = useState(value);
  const today = toDayKey(new Date());

  return (
    <Sheet
      visible={visible}
      title={t('expense.filters')}
      onClose={onClose}
      testID="filter-sheet"
      footer={
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            variant="ghost"
            label={t('expense.clearFilters')}
            onPress={() => setDraft({ ...EMPTY_FILTERS, query: draft.query })}
            style={styles.flex}
            testID="filter-clear"
          />
          <Button
            label={t('expense.applyFilters')}
            onPress={() => onApply(draft)}
            style={styles.flex}
            testID="filter-apply"
          />
        </View>
      }
    >
      <Field label={t('expense.status')}>
        <ChipRow>
          {TRANSACTION_STATUSES.map(s => (
            <Chip
              key={s}
              label={labels.status(s)}
              selected={draft.statuses.includes(s)}
              onPress={() =>
                setDraft({ ...draft, statuses: toggle(draft.statuses, s) })
              }
              testID={`filter-status-${s}`}
            />
          ))}
        </ChipRow>
      </Field>
      <Field label={t('expense.paymentMethod')}>
        <ChipRow>
          {PAYMENT_METHODS.map(m => (
            <Chip
              key={m}
              icon={METHOD_ICONS[m]}
              label={labels.method(m)}
              selected={draft.methods.includes(m)}
              onPress={() =>
                setDraft({ ...draft, methods: toggle(draft.methods, m) })
              }
              testID={`filter-method-${m}`}
            />
          ))}
        </ChipRow>
      </Field>
      <Field label={t('expense.category')}>
        <ChipRow>
          {categories.map(c => (
            <Chip
              key={c.id}
              icon={c.icon}
              color={c.color}
              label={lookup.nameOf(c)}
              selected={draft.categoryIds.includes(c.id)}
              onPress={() =>
                setDraft({
                  ...draft,
                  categoryIds: toggle(draft.categoryIds, c.id),
                })
              }
              testID={`filter-cat-${c.id}`}
            />
          ))}
        </ChipRow>
      </Field>
      <DateField
        label={t('expense.fromDate')}
        value={draft.from}
        onChange={from => setDraft({ ...draft, from })}
        today={today}
        allowClear
        emptyLabel={t('expense.anyDate')}
        testID="filter-from"
      />
      <DateField
        label={t('expense.toDate')}
        value={draft.to}
        onChange={to => setDraft({ ...draft, to })}
        today={today}
        min={draft.from ?? undefined}
        allowClear
        emptyLabel={t('expense.anyDate')}
        testID="filter-to"
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
