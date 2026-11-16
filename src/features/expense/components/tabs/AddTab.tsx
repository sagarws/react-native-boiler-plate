import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Notice, type NoticeProps } from '@/shared/components';
import { useTheme } from '@/theme';
import { useExpenseErrorText } from '../../hooks/useExpense';
import type { ExpenseForm } from '../../hooks/useExpenseForm';
import type { PayProblem } from '../../hooks/useUpiPayment';
import { ExpenseFormFields } from '../ExpenseForm';
import type { TabProps } from './shared';

/**
 * Add an expense by hand, or fill amount / category / note and Scan QR &
 * Pay (the payment method is then UPI).
 */
export function AddTab({
  data,
  lookup,
  bottomPad,
  form,
  saved,
  problem,
  busy,
  onSave,
  onScan,
  onGallery,
  onDismissProblem,
  onOpenSettings,
  onManageCategories,
}: Omit<TabProps, 'openExpense' | 'now'> & {
  form: ExpenseForm;
  /** Confirmation text after a save, if any. */
  saved: string | null;
  problem: PayProblem | null;
  busy: boolean;
  onSave: () => void;
  onScan: () => void;
  onGallery: () => void;
  onDismissProblem: () => void;
  onOpenSettings: () => void;
  onManageCategories: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const errorText = useExpenseErrorText();

  const problemNotice = (p: PayProblem): NoticeProps => ({
    tone:
      p.startsWith('camera') || p.startsWith('gallery') || p === 'no_app'
        ? 'warning'
        : 'error',
    title: t(`expense.problemTitle_${p}`),
    message: t(`expense.problem_${p}`),
    onDismiss: onDismissProblem,
    action:
      p === 'camera_blocked'
        ? { label: t('expense.openSettings'), onPress: onOpenSettings }
        : undefined,
    testID: 'pay-problem',
  });

  return (
    <ScrollView
      testID="expense-add"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: bottomPad,
        gap: spacing.lg,
      }}
    >
      {problem ? <Notice {...problemNotice(problem)} /> : null}
      {saved ? (
        <Notice tone="success" message={saved} testID="add-saved" />
      ) : null}

      <ExpenseFormFields
        form={form}
        categories={data.categories}
        lookup={lookup}
        onManageCategories={onManageCategories}
        testID="add"
      />
      {form.storeError ? (
        <Text style={[typography.caption, { color: colors.error }]}>
          {errorText(form.storeError)}
        </Text>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Button
          size="lg"
          iconName="qrCode"
          label={t('expense.scanAndPay')}
          accessibilityHint={t('expense.scanHint')}
          onPress={onScan}
          loading={busy}
          disabled={busy}
          testID="add-scan"
        />
        <Button
          variant="soft"
          iconName="image"
          label={t('expense.uploadQr')}
          onPress={onGallery}
          disabled={busy}
          testID="add-gallery"
        />
        <Text
          style={[
            typography.caption,
            styles.center,
            { color: colors.textSecondary },
          ]}
        >
          {t('expense.scanHint')}
        </Text>
        <Button
          variant="secondary"
          iconName="check"
          label={t('expense.saveExpense')}
          onPress={onSave}
          testID="add-save"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
});
