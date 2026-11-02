import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { useProjectDetail } from '../hooks/useProgress';
import type { DayKey, LifeData, Project, Task } from '../types';
import { levelStyle } from '../utils/levelColors';
import { ProjectDayDetail } from './dayDetails';
import { MonthCalendar } from './MonthCalendar';
import {
  LevelLegend,
  ProgressLineChart,
  type LineSeries,
} from './progressCharts';
import { ProgressBar, StatCard } from './visuals';

/** Task lines shown at first; the rest start hidden to keep the chart readable. */
const MAX_VISIBLE_TASK_LINES = 6;
export const AVG_ACTUAL_KEY = 'avg-actual';
export const AVG_TARGET_KEY = 'avg-target';

/**
 * The project page's progress: overall actual vs planned, task counts,
 * a calendar shaded by the average completion of the task targets due each
 * day, and a chart with one line per task plus the two averages.
 */
export function ProjectProgressSection({
  data,
  project,
  today,
  onOpenTask,
}: {
  data: LifeData;
  project: Project;
  today: DayKey;
  onOpenTask: (task: Task) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const [month, setMonth] = useState<DayKey>(() =>
    today < project.startDate
      ? project.startDate
      : today > project.deadline
      ? project.deadline
      : today,
  );
  const [selected, setSelected] = useState<DayKey>(today);
  const detail = useProjectDetail(data, project, month, today);
  if (!detail) return null;

  const base = categoryColor(project.color);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const label = [typography.label, { color: colors.textPrimary }];
  const { counts, calendar, chart, overall } = detail;

  const heat = Object.fromEntries(
    Object.values(calendar).map(d => [
      d.day,
      {
        ...levelStyle(base, d.level, colors),
        label: d.percent === null ? null : `${d.percent}%`,
        a11y:
          d.percent !== null
            ? t('life.dayA11yPercent', { percent: d.percent })
            : d.scheduled.length
            ? t('life.dayA11yNoReport')
            : t('life.dayA11yNoTarget'),
      },
    ]),
  );

  const series: LineSeries[] = [
    {
      key: AVG_ACTUAL_KEY,
      label: t('life.lineAverageActual'),
      color: colors.textPrimary,
      values: chart.averageActual,
      emphasis: 'actual',
    },
    {
      key: AVG_TARGET_KEY,
      label: t('life.lineAverageTarget'),
      color: colors.warning,
      values: chart.averageTarget,
      emphasis: 'target',
    },
    ...chart.tasks.map(s => ({
      key: s.task.id,
      label: s.task.name,
      color: categoryColor(s.task.color),
      values: s.actual,
    })),
  ];
  const initiallyHidden = chart.tasks
    .slice(MAX_VISIBLE_TASK_LINES)
    .map(s => s.task.id);

  return (
    <>
      <Card testID="project-progress">
        <View style={{ gap: spacing.sm }}>
          <Text style={label} accessibilityRole="header">
            {t('life.overallTitle')}
          </Text>
          {overall.actual === null ? (
            <Text style={caption}>{t('life.overallNone')}</Text>
          ) : (
            <>
              <ProgressBar percent={overall.actual} color={base} />
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {t('life.overallLine', {
                  actual: Math.round(overall.actual),
                  target: Math.round(overall.target ?? 0),
                })}
              </Text>
            </>
          )}
          <View style={[styles.stats, { gap: spacing.sm }]}>
            <StatCard
              label={t('life.countCompleted')}
              value={String(counts.completed)}
              tone="success"
              testID="project-count-completed"
            />
            <StatCard
              label={t('life.countPending')}
              value={String(counts.pending)}
              testID="project-count-pending"
            />
            <StatCard
              label={t('life.countOverdue')}
              value={String(counts.overdue)}
              tone={counts.overdue ? 'warning' : undefined}
              testID="project-count-overdue"
            />
          </View>
          <Text style={caption}>{t('life.countsHow')}</Text>
          {project.notes ? (
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {`${t('life.notes')}: ${project.notes}`}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card testID="project-calendar-card">
        <View style={{ gap: spacing.sm }}>
          <Text style={label} accessibilityRole="header">
            {t('life.calendarTitle')}
          </Text>
          <MonthCalendar
            month={month}
            onMonthChange={setMonth}
            selected={selected}
            onSelect={setSelected}
            today={today}
            heat={heat}
            testID="project-calendar"
          />
          <LevelLegend base={base} />
          <Text style={caption}>{t('life.dayAverageHow')}</Text>
          <ProjectDayDetail day={calendar[selected]} onOpenTask={onOpenTask} />
        </View>
      </Card>

      <Card testID="project-chart-card">
        <View style={{ gap: spacing.sm }}>
          <Text style={label} accessibilityRole="header">
            {t('life.projectChartTitle')}
          </Text>
          <ProgressLineChart
            days={chart.days}
            series={series}
            initiallyHidden={initiallyHidden}
            emptyText={t('life.projectChartEmpty')}
            testID="project-chart"
          />
          <Text style={caption}>{t('life.projectChartHow')}</Text>
        </View>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', flexWrap: 'wrap' },
});
