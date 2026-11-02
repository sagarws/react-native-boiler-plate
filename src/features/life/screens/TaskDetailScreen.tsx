import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Button, Card, EmptyState, Header } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { TaskDayDetail } from '../components/dayDetails';
import { LogProgressSheet } from '../components/LogProgressSheet';
import { MonthCalendar } from '../components/MonthCalendar';
import { LevelLegend, TargetActualChart } from '../components/progressCharts';
import { Avatar, StatCard } from '../components/visuals';
import { useClock, useDescribeTarget, useLifeData } from '../hooks/useLife';
import { useTaskDetail } from '../hooks/useProgress';
import { percentOf } from '../services/progress';
import type { DayKey, Task } from '../types';
import { formatDuration } from '../utils/dates';
import { formatDay, formatPeriod, formatQty } from '../utils/format';
import { levelStyle } from '../utils/levelColors';

const HISTORY_PAGE = 15;

/**
 * One task in full: target and dates, counts, a calendar shaded by
 * completion of each target period, target vs actual per period, reasons
 * and every progress entry. Everything comes from saved targets and reports.
 */
export default function TaskDetailScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'LifeTask'>>();
  const data = useLifeData();
  const { now, today } = useClock();
  const describe = useDescribeTarget();
  const task = data.tasks.find(x => x.id === params.taskId);
  const [month, setMonth] = useState<DayKey>(() =>
    task && today < task.startDate ? task.startDate : today,
  );
  const [selected, setSelected] = useState<DayKey>(today);
  const [logging, setLogging] = useState<{ task: Task; day: DayKey } | null>(
    null,
  );
  const [historyCount, setHistoryCount] = useState(HISTORY_PAGE);
  const detail = useTaskDetail(data, task, month, today);

  if (!task || !detail) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('life.title')} />
        <EmptyState
          icon="triangleAlert"
          title={t('life.error_not_found')}
          testID="task-missing"
        />
      </View>
    );
  }

  const { summary, calendar, bars, reports, project } = detail;
  const base = categoryColor(task.color);
  const current = summary.current;
  const target = current?.target ?? task.targets[task.targets.length - 1];
  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];
  const label = [typography.label, { color: colors.textPrimary }];

  const heat = Object.fromEntries(
    Object.values(calendar).map(d => {
      const s = levelStyle(base, d.level, colors);
      return [
        d.day,
        {
          ...s,
          label: d.percent === null ? null : `${d.percent}%`,
          a11y:
            d.percent !== null
              ? t('life.dayA11yPercent', { percent: d.percent })
              : d.state
              ? t('life.dayA11yNoReport')
              : t('life.dayA11yNoTarget'),
        },
      ];
    }),
  );

  const timeLine = current
    ? current.status === 'paused'
      ? t('life.status_paused')
      : t('life.periodClosesIn', {
          time: formatDuration(current.closesAt.getTime() - now.getTime()),
          period: formatPeriod(current.start, current.end),
        })
    : summary.nextStart
    ? t('life.startsOn', { date: formatDay(summary.nextStart) })
    : t('life.notRunning');

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={task.name} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
        testID="task-detail"
      >
        <Card testID="task-info">
          <View style={{ gap: spacing.sm }}>
            <View style={[styles.row, { gap: spacing.md }]}>
              <Avatar
                icon={task.icon}
                imageUri={task.imageUri}
                color={task.color}
                size={56}
              />
              <View style={styles.flex}>
                <Text style={[typography.title, { color: colors.textPrimary }]}>
                  {task.name}
                </Text>
                {project ? (
                  <Pressable
                    accessibilityRole="link"
                    onPress={() =>
                      navigation.navigate(ROUTES.LIFE_PROJECT, {
                        projectId: project.id,
                      })
                    }
                    testID="task-project-link"
                  >
                    <Text
                      style={[
                        typography.caption,
                        { color: colors.primaryText },
                      ]}
                    >
                      {project.name}
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={caption}>
                  {t(`life.taskStatus_${task.status}`)}
                </Text>
              </View>
            </View>
            <Text style={body}>{describe(target, task.unit)}</Text>
            <Text style={caption}>
              {task.endDate
                ? t('life.taskDates', {
                    start: formatDay(task.startDate),
                    end: formatDay(task.endDate),
                  })
                : t('life.taskDatesOpen', { start: formatDay(task.startDate) })}
            </Text>
            <Text style={caption} testID="task-time">
              {timeLine}
            </Text>
            {task.description ? (
              <Text style={caption}>{task.description}</Text>
            ) : null}
            <View style={[styles.stats, { gap: spacing.sm }]}>
              <StatCard
                label={t('life.statCurrent')}
                value={current ? `${percentOf(current.ratio)}%` : '–'}
                testID="task-stat-current"
              />
              <StatCard
                label={t('life.statMet')}
                value={String(summary.met)}
                tone="success"
                testID="task-stat-met"
              />
              <StatCard
                label={t('life.statMissed')}
                value={String(summary.missed)}
                tone={summary.missed ? 'warning' : undefined}
                testID="task-stat-missed"
              />
              <StatCard
                label={t('life.statRate')}
                value={
                  summary.successRate === null ? '–' : `${summary.successRate}%`
                }
                testID="task-stat-rate"
              />
            </View>
            {current ? (
              <Text style={caption}>
                {t('life.dayProgress', {
                  done: formatQty(current.completed),
                  target: formatQty(current.target.quantity),
                  unit: task.unit,
                  percent: percentOf(current.ratio),
                })}
              </Text>
            ) : null}
            {task.notes ? (
              <Text style={body}>{`${t('life.notes')}: ${task.notes}`}</Text>
            ) : null}
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Button
                size="sm"
                label={t('life.logProgress')}
                iconName="plus"
                onPress={() => setLogging({ task, day: selected })}
                style={styles.flex}
                testID="task-log"
              />
              <Button
                size="sm"
                variant="secondary"
                label={t('life.edit')}
                onPress={() =>
                  navigation.navigate(ROUTES.LIFE_TASK_FORM, {
                    projectId: task.projectId,
                    taskId: task.id,
                  })
                }
                style={styles.flex}
                testID="task-edit"
              />
            </View>
          </View>
        </Card>

        <Card testID="task-calendar-card">
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
              testID="task-calendar"
            />
            <LevelLegend base={base} />
            <Text style={caption}>{t('life.taskCalendarHow')}</Text>
            <TaskDayDetail
              task={task}
              day={calendar[selected]}
              reports={data.reports}
            />
          </View>
        </Card>

        <Card testID="task-chart-card">
          <View style={{ gap: spacing.sm }}>
            <Text style={label} accessibilityRole="header">
              {t('life.taskChartTitle')}
            </Text>
            <TargetActualChart bars={bars} unit={task.unit} color={base} />
          </View>
        </Card>

        {summary.reviews.length ? (
          <Card testID="task-reasons">
            <View style={{ gap: spacing.sm }}>
              <Text style={label} accessibilityRole="header">
                {t('life.taskReasonsTitle')}
              </Text>
              {summary.reviews.map(r => (
                <View key={r.id} style={{ gap: spacing.xs }}>
                  <Text style={body}>{t(`life.reason_${r.reason}`)}</Text>
                  <Text style={caption}>
                    {formatPeriod(r.periodStart, r.periodEnd)} ·{' '}
                    {formatQty(r.completedQuantity)} /{' '}
                    {formatQty(r.targetQuantity)} {task.unit}
                    {r.note ? ` · ${r.note}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}

        <Card testID="task-history">
          <View style={{ gap: spacing.sm }}>
            <Text style={label} accessibilityRole="header">
              {t('life.historyTitle')}
            </Text>
            {reports.length === 0 ? (
              <Text style={caption}>{t('life.chartNoReports')}</Text>
            ) : (
              reports.slice(0, historyCount).map(r => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setSelected(r.day);
                    setMonth(r.day);
                  }}
                  accessibilityRole="button"
                  accessibilityHint={t('life.showOnCalendar')}
                  style={[styles.row, { gap: spacing.sm }]}
                  testID={`task-history-${r.id}`}
                >
                  <Text style={[caption, styles.day]}>{formatDay(r.day)}</Text>
                  <Text style={[body, styles.flex]} numberOfLines={2}>
                    {formatQty(r.quantity)} {task.unit}
                    {r.note ? ` · ${r.note}` : ''}
                    {r.edits.length ? ` · ${t('life.entryEdited')}` : ''}
                  </Text>
                </Pressable>
              ))
            )}
            {reports.length > historyCount ? (
              <Button
                size="sm"
                variant="ghost"
                label={t('life.showMore', {
                  count: reports.length - historyCount,
                })}
                onPress={() => setHistoryCount(c => c + HISTORY_PAGE)}
                testID="task-history-more"
              />
            ) : null}
          </View>
        </Card>
      </ScrollView>
      <LogProgressSheet
        task={logging?.task ?? null}
        initialDay={logging?.day}
        today={today}
        onClose={() => setLogging(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap' },
  day: { width: 64 },
});
