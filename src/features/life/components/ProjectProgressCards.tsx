import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Notice } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import {
  useLineVisibility,
  useProjectMonth,
  useShades,
} from '../hooks/useProgress';
import type { EvaluateInput } from '../services/periods';
import { clampDay, projectChart } from '../services/progress';
import type { DayKey, Project, Task } from '../types';
import { formatDay, formatLongDay } from '../utils/format';
import { MonthCalendar } from './MonthCalendar';
import { LineToggles, PeriodBreakdown, ProgressLegend } from './ProgressDetail';
import { LineChart, type LineSeries } from './progressCharts';

export const AVG_ACTUAL = 'avgActual';
export const AVG_TARGET = 'avgTarget';

const pct = (v: number) => `${Math.round(v)}%`;

/**
 * The project calendar: each day shaded by the average completion across
 * the task targets scheduled that day (each task against its own target,
 * capped at 100%; units are never added). Tap a day for its tasks.
 */
export function ProjectCalendarCard({
  project,
  tasks,
  input,
  onOpenTask,
}: {
  project: Project;
  tasks: readonly Task[];
  input: EvaluateInput;
  onOpenTask: (task: Task) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const start = clampDay(input.today, project.startDate, project.deadline);
  const [month, setMonth] = useState<DayKey>(start);
  const [selected, setSelected] = useState<DayKey>(start);
  const cells = useProjectMonth(tasks, input, month);
  const shades = useShades(cells);
  const color = categoryColor(project.color);
  const picked = cells[selected];

  return (
    <Card testID="project-calendar-card">
      <Text style={[typography.title, { color: colors.textPrimary }]}>
        {t('life.progressCalendar')}
      </Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textSecondary, marginBottom: spacing.sm },
        ]}
      >
        {t('life.projectCalendarHint')}
      </Text>
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={setSelected}
        today={input.today}
        shades={shades}
        shadeColor={color}
        testID="project-calendar"
      />
      <ProgressLegend color={color} />
      <View
        style={[
          styles.divider,
          { marginVertical: spacing.sm, backgroundColor: colors.divider },
        ]}
      />
      {picked && picked.percent !== null ? (
        <Text
          style={[typography.label, { color: colors.textPrimary }]}
          testID="project-day-average"
        >
          {t('life.projectDayAverage', {
            percent: picked.percent,
            count: picked.states.length,
          })}
        </Text>
      ) : null}
      <PeriodBreakdown
        day={selected}
        states={picked?.states ?? []}
        reports={input.reports}
        showTask
        onOpenTask={onOpenTask}
        testID="project-day"
      />
    </Card>
  );
}

/**
 * One line per task (% of its own planned total reported so far), the
 * average actual line and the average target line; each can be hidden.
 */
export function ProjectChartCard({
  project,
  tasks,
  input,
}: {
  project: Project;
  tasks: readonly Task[];
  input: EvaluateInput;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const chart = useMemo(
    () => projectChart(project, tasks, input),
    [project, tasks, input],
  );
  const { hidden, toggle } = useLineVisibility(chart.tasks.map(l => l.task.id));

  const all: LineSeries[] = [
    ...chart.tasks.map(l => ({
      id: l.task.id,
      label: l.task.name,
      color: categoryColor(l.task.color),
      values: l.actual,
      style: 'solid' as const,
    })),
    {
      id: AVG_ACTUAL,
      label: t('life.chartAvgActual'),
      color: colors.textPrimary,
      values: chart.avgActual,
      style: 'bold',
    },
    {
      id: AVG_TARGET,
      label: t('life.chartAvgTarget'),
      color: colors.textSecondary,
      values: chart.avgTarget,
      style: 'dashed',
    },
  ];
  const visible = all.filter(s => !hidden.has(s.id));
  // 0–100%, stretched (up to 200%) when a visible line is ahead of plan.
  const top = Math.min(
    200,
    Math.max(
      100,
      ...visible.flatMap(s => s.values.filter((v): v is number => v !== null)),
    ),
  );

  return (
    <Card testID="project-chart-card">
      <Text style={[typography.title, { color: colors.textPrimary }]}>
        {t('life.progressChart')}
      </Text>
      <Text
        style={[
          typography.caption,
          { color: colors.textSecondary, marginBottom: spacing.sm },
        ]}
      >
        {t('life.projectChartHint')}
      </Text>
      {chart.tasks.length ? (
        <View style={{ gap: spacing.sm }}>
          <LineToggles
            items={all.map(s => ({
              id: s.id,
              label: s.label,
              color: s.color,
              style: s.style,
              visible: !hidden.has(s.id),
            }))}
            onToggle={toggle}
            testID="project-chart-toggle"
          />
          <LineChart
            series={visible}
            labels={chart.dates.map(formatDay)}
            a11yLabels={chart.dates.map(formatLongDay)}
            format={pct}
            yMax={Math.ceil(top / 50) * 50}
            emptyText={t('life.chartAllHidden')}
            testID="project-chart"
          />
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('life.chartAvgExplain')}
          </Text>
        </View>
      ) : (
        <Text
          testID="project-chart-empty"
          style={[typography.caption, { color: colors.textSecondary }]}
        >
          {t('life.chartEmptyProject')}
        </Text>
      )}
      {chart.skipped.length ? (
        <Notice
          tone="info"
          message={t('life.chartSkipped', {
            names: chart.skipped.map(x => x.name).join(', '),
          })}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  divider: { height: StyleSheet.hairlineWidth },
});
