import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/features/followup';
import { FormField } from '@/features/life';
import { Button, Icon, Notice, SegmentedControl } from '@/shared/components';
import { useTheme } from '@/theme';
import type { PayHow, UpiPayment } from '../hooks/useUpiPayment';
import type { UpiPayee } from '../services/upi';
import type { UpiApp } from '../services/native.service';
import type { Expense } from '../types';
import { formatInr, parseAmount } from '../utils/money';

function DetailRow({ label, value }: { label: string; value: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={[styles.detail, { gap: spacing.md }]}>
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[typography.label, styles.value, { color: colors.textPrimary }]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function PayeeCard({ payee, amount }: { payee: UpiPayee; amount?: number }) {
  const { t } = useTranslation();
  const { colors, spacing, radius } = useTheme();
  return (
    <View
      style={{
        backgroundColor: colors.surfaceMuted,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.xs,
      }}
    >
      <DetailRow
        label={t('expense.payee')}
        value={payee.name || t('expense.unnamedPayee')}
      />
      <DetailRow label={t('expense.upiId')} value={payee.upiId} />
      {amount !== undefined ? (
        <DetailRow label={t('expense.amount')} value={formatInr(amount)} />
      ) : null}
    </View>
  );
}

function AmountOption({
  label,
  amount,
  onPress,
  testID,
}: {
  label: string;
  amount: number;
  onPress: () => void;
  testID: string;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${formatInr(amount)}`}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.lg,
          backgroundColor: pressed ? colors.primarySoft : colors.card,
        },
      ]}
    >
      <Text style={[typography.caption, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <Text style={[typography.h2, { color: colors.textPrimary }]}>
        {formatInr(amount)}
      </Text>
    </Pressable>
  );
}

function EnterAmount({
  payee,
  onContinue,
  onClose,
}: {
  payee: UpiPayee;
  onContinue: (amount: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [text, setText] = useState('');
  const [invalid, setInvalid] = useState(false);
  return (
    <Sheet
      visible
      title={t('expense.enterAmountTitle')}
      subtitle={t('expense.enterAmountHint')}
      onClose={onClose}
      testID="pay-enter-amount"
      footer={
        <Button
          label={t('expense.continue')}
          onPress={() => {
            const amount = parseAmount(text);
            if (amount === null) setInvalid(true);
            else onContinue(amount);
          }}
          testID="pay-enter-amount-continue"
        />
      }
    >
      <PayeeCard payee={payee} />
      <FormField
        label={t('expense.amount')}
        value={text}
        onChangeText={value => {
          setText(value);
          setInvalid(false);
        }}
        keyboardType="decimal-pad"
        maxLength={12}
        placeholder="0"
        testID="pay-enter-amount-field"
      />
      {invalid ? (
        <Text style={[typography.caption, { color: colors.error }]}>
          {t('expense.error_amount')}
        </Text>
      ) : null}
    </Sheet>
  );
}

type ChooseStep = Extract<UpiPayment['step'], { kind: 'chooseApp' }>;

/**
 * Pick a UPI app, and how to pay with it: hand it the payment link (the
 * default — payee and amount filled in, and the UPI app returns here), or
 * open it to scan the QR there, the fallback when a UPI app refuses a
 * payment to a person that another app started.
 */
function ChooseApp({
  payment,
  step,
  onPaid,
}: {
  payment: UpiPayment;
  step: ChooseStep;
  onPaid: (expense: Expense) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const [how, setHow] = useState<PayHow>('link');
  const scan = how === 'scanInApp';
  const payWith = async (app: UpiApp | null, method?: PayHow) => {
    const saved = await payment.pay(app, method);
    if (saved) onPaid(saved);
  };
  return (
    <Sheet
      visible
      title={t('expense.payWith')}
      subtitle={t('expense.payWithHint')}
      onClose={payment.cancel}
      testID="pay-apps"
    >
      <PayeeCard payee={step.payee} amount={step.amount} />
      <Notice tone="warning" message={t('expense.checkPayee')} />
      <SegmentedControl
        options={[
          { value: 'link', label: t('expense.howLink') },
          { value: 'scanInApp', label: t('expense.howScan') },
        ]}
        value={how}
        onChange={setHow}
        accessibilityLabel={t('expense.howTitle')}
        testID="pay-how"
      />
      <Text
        style={[typography.caption, { color: colors.textSecondary }]}
        testID="pay-how-hint"
      >
        {scan
          ? t('expense.howScanHint')
          : step.payee.personal
          ? t('expense.howLinkPersonalHint')
          : t('expense.howLinkHint')}
      </Text>
      {step.apps.length ? null : (
        <Notice
          tone="info"
          title={t('expense.noUpiApps')}
          message={t('expense.noUpiAppsHint')}
          testID="pay-no-apps"
        />
      )}
      {step.apps.map(app => (
        <Pressable
          key={app.packageName}
          testID={`pay-app-${app.packageName}`}
          onPress={() => payWith(app, how)}
          accessibilityRole="button"
          accessibilityLabel={
            scan
              ? t('expense.scanInApp', { app: app.label })
              : t('expense.payWithApp', { app: app.label })
          }
          style={({ pressed }) => [
            styles.appRow,
            {
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.primarySoft : colors.card,
            },
          ]}
        >
          {app.icon ? (
            <Image
              source={{ uri: app.icon }}
              style={styles.appIcon}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <View
              style={[
                styles.appIcon,
                styles.center,
                {
                  backgroundColor: colors.surfaceMuted,
                  borderRadius: radius.md,
                },
              ]}
            >
              <Icon name="smartphone" size={20} color={colors.textSecondary} />
            </View>
          )}
          <Text
            style={[
              typography.label,
              styles.flex,
              { color: colors.textPrimary },
            ]}
            numberOfLines={1}
          >
            {scan ? t('expense.scanInApp', { app: app.label }) : app.label}
          </Text>
          <Icon name="chevronRight" size={18} color={colors.textSecondary} />
        </Pressable>
      ))}
      {scan ? null : (
        <Pressable
          testID="pay-app-chooser"
          onPress={() => payWith(null)}
          accessibilityRole="button"
          accessibilityLabel={t('expense.otherUpiApp')}
          style={({ pressed }) => [
            styles.appRow,
            {
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radius.lg,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.primarySoft : colors.card,
            },
          ]}
        >
          <View
            style={[
              styles.appIcon,
              styles.center,
              {
                backgroundColor: colors.surfaceMuted,
                borderRadius: radius.md,
              },
            ]}
          >
            <Icon name="smartphone" size={20} color={colors.textSecondary} />
          </View>
          <View style={styles.flex}>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('expense.otherUpiApp')}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('expense.otherUpiAppHint')}
            </Text>
          </View>
          <Icon name="chevronRight" size={18} color={colors.textSecondary} />
        </Pressable>
      )}
    </Sheet>
  );
}

/**
 * Every sheet of the Scan QR & Pay flow, driven by the payment hook's step.
 * [onPaid] runs once the UPI app was opened; the payment is already
 * recorded as paid, whatever happens in that app.
 */
export function PaymentSheets({
  payment,
  onPaid,
}: {
  payment: UpiPayment;
  onPaid: (expense: Expense) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { step } = payment;

  switch (step.kind) {
    case 'chooseAmount':
      return (
        <Sheet
          visible
          title={t('expense.chooseAmountTitle')}
          subtitle={t('expense.chooseAmountHint')}
          onClose={payment.cancel}
          testID="pay-choose-amount"
        >
          <PayeeCard payee={step.payee} />
          <AmountOption
            label={t('expense.qrAmount')}
            amount={step.qrAmount}
            onPress={() => payment.pickAmount(step.qrAmount)}
            testID="pay-amount-qr"
          />
          <AmountOption
            label={t('expense.enteredAmount')}
            amount={step.enteredAmount}
            onPress={() => payment.pickAmount(step.enteredAmount)}
            testID="pay-amount-entered"
          />
        </Sheet>
      );
    case 'enterAmount':
      return (
        <EnterAmount
          payee={step.payee}
          onContinue={payment.pickAmount}
          onClose={payment.cancel}
        />
      );
    case 'loadingApps':
      return (
        <Sheet
          visible
          title={t('expense.findingApps')}
          onClose={payment.cancel}
          testID="pay-loading"
        >
          <ActivityIndicator color={colors.primary} />
        </Sheet>
      );
    case 'chooseApp':
      return <ChooseApp payment={payment} step={step} onPaid={onPaid} />;
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  detail: { flexDirection: 'row', justifyContent: 'space-between' },
  value: { flexShrink: 1, textAlign: 'right' },
  option: { borderWidth: 1, gap: 4 },
  row: { flexDirection: 'row' },
  flex: { flex: 1 },
  appRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1 },
  appIcon: { width: 40, height: 40 },
  center: { alignItems: 'center', justifyContent: 'center' },
});
