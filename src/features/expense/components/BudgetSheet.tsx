import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/features/followup';
import { FormField } from '@/features/life';
import { Button } from '@/shared/components';
import { useTheme } from '@/theme';
import { expenseActions } from '../hooks/useExpense';
import { parseAmount, toAmountInput } from '../utils/money';

/** Sets, changes or removes the monthly budget. */
export function BudgetSheet({
  visible,
  budget,
  onClose,
}: {
  visible: boolean;
  /** Current budget in paise, or null. */
  budget: number | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [text, setText] = useState(budget ? toAmountInput(budget) : '');
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const amount = parseAmount(text);
    if (amount === null || !expenseActions.setBudget(amount).ok) {
      setInvalid(true);
      return;
    }
    onClose();
  };

  const remove = () => {
    expenseActions.setBudget(null);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('expense.budgetTitle')}
      subtitle={t('expense.budgetHint')}
      onClose={onClose}
      testID="budget-sheet"
      footer={
        <View style={[styles.row, { gap: spacing.sm }]}>
          {budget ? (
            <Button
              variant="ghost"
              label={t('expense.removeBudget')}
              onPress={remove}
              style={styles.flex}
              testID="budget-remove"
            />
          ) : null}
          <Button
            label={t('expense.save')}
            onPress={save}
            style={styles.flex}
            testID="budget-save"
          />
        </View>
      }
    >
      <FormField
        label={t('expense.budgetAmount')}
        value={text}
        onChangeText={value => {
          setText(value);
          setInvalid(false);
        }}
        keyboardType="decimal-pad"
        maxLength={12}
        placeholder="20000"
        testID="budget-amount"
      />
      {invalid ? (
        <Text style={[typography.caption, { color: colors.error }]}>
          {t('expense.error_amount')}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
});
