import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar } from '@/features/life';
import { StatusPill } from '@/shared/components';
import { useTheme } from '@/theme';
import type { Expense, ExpenseCategory } from '../types';
import { formatInr } from '../utils/money';
import { formatWhen, STATUS_TONE, useExpenseLabels } from './labels';

/** One transaction: category icon, merchant/description, method, date, status. */
export function TransactionRow({
  expense,
  category,
  categoryName,
  onPress,
  testID,
}: {
  expense: Expense;
  category: ExpenseCategory;
  categoryName: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  const labels = useExpenseLabels();
  const title = expense.merchantName || expense.description || categoryName;
  const meta = [categoryName, labels.method(expense.paymentMethod)].join(' · ');
  const amount = formatInr(expense.amount);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${amount}, ${meta}, ${formatWhen(
        expense.transactionDate,
      )}, ${labels.status(expense.status)}`}
      style={({ pressed }) => [
        styles.row,
        {
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: pressed ? colors.surfaceMuted : colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <Avatar icon={category.icon} color={category.color} size={40} />
      <View style={styles.flex}>
        <Text
          style={[typography.label, { color: colors.textPrimary }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={[typography.caption, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {meta}
        </Text>
        <Text
          style={[typography.caption, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {formatWhen(expense.transactionDate)}
        </Text>
      </View>
      <View style={[styles.end, { gap: spacing.xs }]}>
        <Text
          style={[
            typography.title,
            {
              color:
                expense.status === 'failed'
                  ? colors.textSecondary
                  : colors.textPrimary,
            },
            expense.status === 'failed' && styles.struck,
          ]}
          numberOfLines={1}
        >
          {amount}
        </Text>
        <StatusPill
          label={labels.status(expense.status)}
          tone={STATUS_TONE[expense.status]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  flex: { flex: 1 },
  end: { alignItems: 'flex-end' },
  struck: { textDecorationLine: 'line-through' },
});
