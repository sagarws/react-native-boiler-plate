import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/features/followup';
import { Button } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  expenseActions,
  useExpenseErrorText,
  type CategoryLookup,
} from '../hooks/useExpense';
import { useExpenseForm } from '../hooks/useExpenseForm';
import type { Expense, ExpenseCategory } from '../types';
import { formatInr } from '../utils/money';
import { ExpenseFormFields } from './ExpenseForm';

/**
 * Edit a transaction — including moving a pending payment to paid or
 * failed — or delete it after a confirmation. Mount with a `key` per expense.
 */
export function EditExpenseSheet({
  expense,
  onClose,
  categories,
  lookup,
  onManageCategories,
}: {
  expense: Expense;
  onClose: () => void;
  categories: ExpenseCategory[];
  lookup: CategoryLookup;
  onManageCategories: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const errorText = useExpenseErrorText();
  const form = useExpenseForm(expense);

  const save = () => {
    if (form.save()?.ok) onClose();
  };

  const remove = () =>
    Alert.alert(
      t('expense.deleteTitle'),
      t('expense.deleteMessage', { amount: formatInr(expense.amount) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            expenseActions.deleteExpense(expense.id);
            onClose();
          },
        },
      ],
    );

  const payee = [expense.merchantName, expense.merchantUpiId]
    .filter(Boolean)
    .join(' · ');

  return (
    <Sheet
      visible
      title={t('expense.editTitle')}
      subtitle={payee || undefined}
      onClose={onClose}
      testID="edit-sheet"
      footer={
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            variant="danger"
            iconName="trash2"
            label={t('common.delete')}
            onPress={remove}
            style={styles.flex}
            testID="edit-delete"
          />
          <Button
            label={t('expense.save')}
            onPress={save}
            style={styles.flex}
            testID="edit-save"
          />
        </View>
      }
    >
      <ExpenseFormFields
        form={form}
        categories={categories}
        lookup={lookup}
        showStatus
        onManageCategories={onManageCategories}
        testID="edit"
      />
      {form.storeError ? (
        <Text style={[typography.caption, { color: colors.error }]}>
          {errorText(form.storeError)}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
