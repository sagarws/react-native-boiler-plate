import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ProgressBar, StatCard } from '@/features/life';
import { Button, Card, EmptyState, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { budgetState, summarize } from '../../services/analytics';
import { formatInr } from '../../utils/money';
import { TransactionRow } from '../TransactionRow';
import type { TabProps } from './shared';

const RECENT = 5;

/** Today · this month · transactions · budget, pending payments and recent. */
export function OverviewTab({
  data,
  lookup,
  now,
  bottomPad,
  openExpense,
  onAdd,
  onScan,
  onBudget,
  onPending,
  onSeeAll,
}: TabProps & {
  onAdd: () => void;
  onScan: () => void;
  onBudget: () => void;
  onPending: () => void;
  onSeeAll: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const summary = useMemo(
    () => summarize(data.expenses, now),
    [data.expenses, now],
  );
  const budget = budgetState(data.settings.monthlyBudget, summary.month);
  const recent = useMemo(
    () =>
      [...data.expenses]
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate))
        .slice(0, RECENT),
    [data.expenses],
  );
  const over = budget ? budget.remaining < 0 : false;

  return (
    <ScrollView
      testID="expense-overview"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: bottomPad,
        gap: spacing.lg,
      }}
    >
      <View style={[styles.grid, { gap: spacing.sm }]}>
        <StatCard
          label={t('expense.sumToday')}
          value={formatInr(summary.today)}
          testID="sum-today"
        />
        <StatCard
          label={t('expense.sumMonth')}
          value={formatInr(summary.month)}
          testID="sum-month"
        />
        <StatCard
          label={t('expense.sumCount')}
          value={String(summary.monthCount)}
          testID="sum-count"
        />
        <StatCard
          label={t('expense.sumBudget')}
          value={budget ? formatInr(budget.budget) : t('expense.budgetNotSet')}
          tone={over ? 'warning' : undefined}
          onPress={onBudget}
          testID="sum-budget"
        />
      </View>

      {budget ? (
        <Card testID="budget-card">
          <View style={{ gap: spacing.sm }}>
            <View style={styles.between}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('expense.budgetUsed', { percent: budget.percent })}
              </Text>
              <Text
                style={[
                  typography.caption,
                  { color: over ? colors.error : colors.textSecondary },
                ]}
              >
                {over
                  ? t('expense.overBudget', {
                      amount: formatInr(-budget.remaining),
                    })
                  : t('expense.budgetLeft', {
                      amount: formatInr(budget.remaining),
                    })}
              </Text>
            </View>
            <ProgressBar
              percent={budget.percent}
              color={
                over
                  ? colors.error
                  : budget.percent >= 80
                  ? colors.warning
                  : colors.success
              }
              height={8}
              testID="budget-progress"
            />
          </View>
        </Card>
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <Button
          size="lg"
          iconName="qrCode"
          label={t('expense.scanAndPay')}
          onPress={onScan}
          testID="overview-scan"
        />
        <Button
          variant="soft"
          iconName="plus"
          label={t('expense.addExpense')}
          onPress={onAdd}
          testID="overview-add"
        />
      </View>

      {summary.pendingCount ? (
        <Notice
          tone="warning"
          title={t('expense.pendingTitle', { count: summary.pendingCount })}
          message={t('expense.pendingMessage', {
            amount: formatInr(summary.pendingAmount),
          })}
          action={{ label: t('expense.review'), onPress: onPending }}
          testID="pending-notice"
        />
      ) : null}

      <View style={{ gap: spacing.sm }}>
        <View style={styles.between}>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {t('expense.recent')}
          </Text>
          {recent.length ? (
            <Button
              size="sm"
              variant="ghost"
              label={t('expense.seeAll')}
              onPress={onSeeAll}
              testID="overview-see-all"
            />
          ) : null}
        </View>
        {recent.length ? (
          recent.map(e => (
            <TransactionRow
              key={e.id}
              expense={e}
              category={lookup.get(e.categoryId)}
              categoryName={lookup.nameById(e.categoryId)}
              onPress={() => openExpense(e)}
              testID={`recent-${e.id}`}
            />
          ))
        ) : (
          <EmptyState
            compact
            icon="receipt"
            title={t('expense.emptyTitle')}
            message={t('expense.emptyMessage')}
            testID="overview-empty"
          />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
