import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip, ChipRow, Field, timeOf } from '@/features/followup';
import { DateField, FormField } from '@/features/life';
import { Icon } from '@/shared/components';
import { toDayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import type { CategoryLookup } from '../hooks/useExpense';
import type { ExpenseForm as Form } from '../hooks/useExpenseForm';
import {
  METHOD_ICONS,
  PAYMENT_METHODS,
  TRANSACTION_STATUSES,
  type ExpenseCategory,
} from '../types';
import { useExpenseLabels } from './labels';

/**
 * Amount · category · description · payment method · (status) · date & time.
 * Shared by the Add tab and the edit sheet.
 */
export function ExpenseFormFields({
  form,
  categories,
  lookup,
  showStatus = false,
  showMethod = true,
  onManageCategories,
  testID,
}: {
  form: Form;
  categories: ExpenseCategory[];
  lookup: CategoryLookup;
  showStatus?: boolean;
  showMethod?: boolean;
  onManageCategories?: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const labels = useExpenseLabels();
  const { draft, set, errors } = form;
  const today = toDayKey(new Date());
  const errorText = (text: string) => (
    <Text style={[typography.caption, { color: colors.error }]}>{text}</Text>
  );

  return (
    <View style={{ gap: spacing.lg }}>
      <Field label={t('expense.amount')}>
        <View
          style={[
            styles.amountBox,
            {
              borderColor: errors.includes('amount')
                ? colors.error
                : colors.border,
              backgroundColor: colors.surface,
              borderRadius: radius.lg,
              paddingHorizontal: spacing.md,
              gap: spacing.sm,
            },
          ]}
        >
          <Icon name="indianRupee" size={26} color={colors.textSecondary} />
          <TextInput
            testID={`${testID}-amount`}
            value={draft.amount}
            onChangeText={amount => set({ amount })}
            placeholder="0"
            placeholderTextColor={colors.placeholder}
            keyboardType="decimal-pad"
            maxLength={12}
            accessibilityLabel={t('expense.amount')}
            style={[typography.h1, styles.flex, { color: colors.textPrimary }]}
          />
        </View>
        {errors.includes('amount')
          ? errorText(t('expense.error_amount'))
          : null}
      </Field>

      <Field label={t('expense.category')}>
        <ChipRow>
          {categories.map(c => (
            <Chip
              key={c.id}
              icon={c.icon}
              color={c.color}
              label={lookup.nameOf(c)}
              selected={draft.categoryId === c.id}
              onPress={() => set({ categoryId: c.id })}
              testID={`${testID}-cat-${c.id}`}
            />
          ))}
          {onManageCategories ? (
            <Chip
              icon="pencil"
              label={t('expense.manageCategories')}
              selected={false}
              onPress={onManageCategories}
              testID={`${testID}-manage-categories`}
            />
          ) : null}
        </ChipRow>
      </Field>

      <FormField
        label={t('expense.description')}
        value={draft.description}
        onChangeText={description => set({ description })}
        placeholder={t('expense.descriptionPlaceholder')}
        maxLength={200}
        testID={`${testID}-description`}
      />

      {showMethod ? (
        <Field label={t('expense.paymentMethod')}>
          <ChipRow>
            {PAYMENT_METHODS.map(m => (
              <Chip
                key={m}
                icon={METHOD_ICONS[m]}
                label={labels.method(m)}
                selected={draft.paymentMethod === m}
                onPress={() => set({ paymentMethod: m })}
                testID={`${testID}-method-${m}`}
              />
            ))}
          </ChipRow>
        </Field>
      ) : null}

      {showStatus ? (
        <Field label={t('expense.status')}>
          <ChipRow>
            {TRANSACTION_STATUSES.map(s => (
              <Chip
                key={s}
                label={labels.status(s)}
                selected={draft.status === s}
                onPress={() => set({ status: s })}
                testID={`${testID}-status-${s}`}
              />
            ))}
          </ChipRow>
        </Field>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <DateField
          label={t('expense.date')}
          value={draft.day}
          onChange={day => day && set({ day })}
          today={today}
          testID={`${testID}-date`}
        />
        <View style={[styles.timeRow, { gap: spacing.sm }]}>
          <View style={styles.flex}>
            <FormField
              label={t('expense.time')}
              value={draft.time}
              onChangeText={time => set({ time })}
              placeholder="14:30"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              testID={`${testID}-time`}
            />
          </View>
          <Chip
            icon="clock"
            label={t('expense.now')}
            selected={false}
            onPress={() => {
              const now = new Date();
              set({ day: toDayKey(now), time: timeOf(now) });
            }}
            testID={`${testID}-now`}
          />
        </View>
        {errors.includes('time') ? errorText(t('expense.error_time')) : null}
        {errors.includes('future')
          ? errorText(t('expense.error_future'))
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 64,
  },
  flex: { flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'flex-end' },
});
