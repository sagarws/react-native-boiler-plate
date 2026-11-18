import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { useShades, useTaskMonth } from '../hooks/useProgress';
import type { EvaluateInput } from '../services/periods';
import { clampDay, taskPeriodPage } from '../services/progress';
import type { DayKey, Task } from '../types';
import { formatDay, formatPeriod, formatQty } from '../utils/format';
import { MonthCalendar } from './MonthCalendar';
import { PeriodBreakdown, ProgressLegend } from './ProgressDetail';
import { TargetActualChart } from './progressCharts';

/** Periods per chart page. */
const CHART_PERIODS = 7;

/**
 * The task's calendar: each day shaded by its target period's completion
 * (a weekly or every-N-days period shades all of its days alike), with a
 * legend and the selected day's target, done, %, notes and reason.
 */
export function TaskCalendarCard({
  task,
  input,
}: {
  task: Task;
  input: EvaluateInput;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const last = task.endDate ?? input.today;
  const start = clampDay(input.today, task.startDate, last);
  const [month, setMonth] = useState<DayKey>(start);
  const [selected, setSelected] = useState<DayKey>(start);
  const cells = useTaskMonth(task, input, month);
  const shades = useShades(cells);
  const color = categoryColor(task.color);
  const picked = cells[selected];

  return (
    <Card testID="task-calendar-card">
      <Text style={[typography.title, { color: colors.textPrimary }]}>
        {t('life.progressCalendar')}
      </Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textSecondary, marginBottom: spacing.sm },
        ]}
      >
        {t('life.taskCalendarHint')}
      </Text>
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={setSelected}
        today={input.today}
        shades={shades}
        shadeColor={color}
        testID="task-calendar"
      />
      <ProgressLegend color={color} />
      <View
        style={[
          styles.divider,
          { marginVertical: spacing.sm, backgroundColor: colors.divider },
        ]}
      />
      <PeriodBreakdown
        day={selected}
        states={
          picked?.state && picked.level !== 'none'
            ? [{ ...picked.state, task }]
            : []
        }
        reports={input.reports}
        testID="task-day"
      />
    </Card>
  );
}

/** Target vs actual per period, in the task's unit, a page at a time. */
export function TaskChartCard({
  task,
  input,
}: {
  task: Task;
  input: EvaluateInput;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [page, setPage] = useState(0);
  const { states, hasOlder, hasNewer } = taskPeriodPage(
    task,
    input,
    CHART_PERIODS,
    page,
  );
  const rows = states.map(s => ({
    key: s.start,
    label: formatDay(s.start),
    title: formatPeriod(s.start, s.end),
    target: s.target.quantity,
    actual: s.completed,
    percent: s.ratio * 100,
  }));

  return (
    <Card testID="task-chart-card">
      <Text style={[typography.title, { color: colors.textPrimary }]}>
        {t('life.progressChart')}
      </Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textSecondary, marginBottom: spacing.sm },
        ]}
      >
        {t('life.taskChartHint')}
      </Text>
      <TargetActualChart
        rows={rows}
        unit={task.unit}
        color={categoryColor(task.color)}
        format={formatQty}
        emptyText={t('life.chartEmptyTask')}
        testID="task-chart"
      />
      {hasOlder || hasNewer ? (
        <View style={[styles.row, { gap: spacing.sm, marginTop: spacing.sm }]}>
          <Button
            size="sm"
            variant="ghost"
            iconName="arrowLeft"
            label={t('life.chartOlder')}
            disabled={!hasOlder}
            onPress={() => setPage(p => p + 1)}
            testID="task-chart-older"
          />
          <Button
            size="sm"
            variant="ghost"
            iconName="chevronRight"
            label={t('life.chartNewer')}
            disabled={!hasNewer}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            testID="task-chart-newer"
          />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  divider: { height: StyleSheet.hairlineWidth },
});
