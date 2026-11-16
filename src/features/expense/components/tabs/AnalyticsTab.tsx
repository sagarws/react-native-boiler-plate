import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BarChart, formatDay, HBars, type BarPoint } from '@/features/life';
import { Card, SegmentedControl } from '@/shared/components';
import { startOfDay } from '@/shared/utils/dayKey';
import { categoryColor, useTheme } from '@/theme';
import {
  byCategory,
  byMethod,
  dailySeries,
  inRange,
  monthlySeries,
  weeklySeries,
  type BreakdownRange,
  type SeriesPoint,
} from '../../services/analytics';
import { formatInr } from '../../utils/money';
import { useExpenseLabels } from '../labels';
import type { TabProps } from './shared';

type Granularity = 'daily' | 'weekly' | 'monthly';

function labelFor(g: Granularity, p: SeriesPoint): string {
  const date = startOfDay(p.start);
  if (g === 'daily') return date.toLocaleDateString([], { weekday: 'short' });
  if (g === 'weekly') return formatDay(p.start);
  return date.toLocaleDateString([], { month: 'short' });
}

/** Spending trend (daily / weekly / monthly) and where the money went. */
export function AnalyticsTab({ data, lookup, now, bottomPad }: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const labels = useExpenseLabels();
  const [granularity, setGranularity] = useState<Granularity>('daily');
  const [range, setRange] = useState<BreakdownRange>('month');

  const series = useMemo(() => {
    const fn =
      granularity === 'daily'
        ? dailySeries
        : granularity === 'weekly'
        ? weeklySeries
        : monthlySeries;
    return fn(data.expenses, now);
  }, [data.expenses, granularity, now]);

  const points: BarPoint[] = series.map(p => {
    const label = labelFor(granularity, p);
    return {
      label,
      // Rupees for the bar height; the exact amount is in the label.
      value: p.total ? p.total / 100 : null,
      a11y: `${label}: ${formatInr(p.total)}`,
    };
  });
  const max = Math.max(...series.map(p => p.total / 100), 1);
  const periodTotal = series.reduce((s, p) => s + p.total, 0);

  const scoped = useMemo(
    () => inRange(data.expenses, range, now),
    [data.expenses, range, now],
  );
  const categoryRows = byCategory(scoped).map(r => {
    const c = lookup.get(r.key);
    return {
      label: lookup.nameOf(c),
      value: r.total,
      display: formatInr(r.total),
      color: categoryColor(c.color),
    };
  });
  const methodRows = byMethod(scoped).map(r => ({
    label: labels.method(r.key),
    value: r.total,
    display: formatInr(r.total),
  }));

  return (
    <ScrollView
      testID="expense-analytics"
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: bottomPad,
        gap: spacing.lg,
      }}
    >
      <Card>
        <View style={{ gap: spacing.md }}>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {t('expense.trendTitle')}
          </Text>
          <SegmentedControl
            options={[
              { value: 'daily', label: t('expense.daily') },
              { value: 'weekly', label: t('expense.weekly') },
              { value: 'monthly', label: t('expense.monthly') },
            ]}
            value={granularity}
            onChange={setGranularity}
            accessibilityLabel={t('expense.trendTitle')}
            testID="analytics-granularity"
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t(`expense.trendTotal_${granularity}`, {
              amount: formatInr(periodTotal),
            })}
          </Text>
          <BarChart
            points={points}
            max={max}
            height={140}
            emptyText={t('expense.noSpending')}
            testID="analytics-trend"
          />
        </View>
      </Card>

      <SegmentedControl
        options={[
          { value: 'month', label: t('expense.thisMonth') },
          { value: 'all', label: t('expense.allTime') },
        ]}
        value={range}
        onChange={setRange}
        accessibilityLabel={t('expense.breakdownRange')}
        testID="analytics-range"
      />

      <Card>
        <View style={{ gap: spacing.md }}>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {t('expense.byCategory')}
          </Text>
          <HBars
            rows={categoryRows}
            emptyText={t('expense.noSpending')}
            testID="analytics-category"
          />
        </View>
      </Card>

      <Card>
        <View style={{ gap: spacing.md }}>
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {t('expense.byMethod')}
          </Text>
          <HBars
            rows={methodRows}
            emptyText={t('expense.noSpending')}
            testID="analytics-method"
          />
        </View>
      </Card>
    </ScrollView>
  );
}
