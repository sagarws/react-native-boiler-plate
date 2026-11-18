import React, { useMemo, useState } from 'react';
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
import { Button, Card, EmptyState, Header, Notice } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { LogProgressSheet } from '../components/LogProgressSheet';
import { ReviewSheet } from '../components/ReviewSheet';
import {
  TaskCalendarCard,
  TaskChartCard,
} from '../components/TaskProgressCards';
import { Avatar, Badge, ProgressBar, StatCard } from '../components/visuals';
import { useClock, useDescribeTarget, useLifeData } from '../hooks/useLife';
import {
  pendingReviews,
  streak,
  targetOn,
  type PeriodState,
} from '../services/periods';
import { taskStats } from '../services/progress';
import type { Task } from '../types';
import { formatDuration } from '../utils/dates';
import {
  formatDay,
  formatLongDay,
  formatPeriod,
  formatQty,
} from '../utils/format';

/** History entries shown before "Show all". */
const HISTORY_PAGE = 15;

/**
 * One task: its target and dates, current period, met / missed counts,
 * notes, a progress calendar, a target-vs-actual chart and its history
 * (reports and incomplete reasons).
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
  const [logging, setLogging] = useState<Task | null>(null);
  const [reviewing, setReviewing] = useState<
    (PeriodState & { task: Task }) | null
  >(null);
  const [showAll, setShowAll] = useState(false);
  const input = useMemo(
    () => ({ reports: data.reports, reviews: data.reviews, today }),
    [data.reports, data.reviews, today],
  );
  const task = data.tasks.find(x => x.id === params.taskId);
  const project = task
    ? data.projects.find(p => p.id === task.projectId)
    : undefined;

  if (!task) {
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

  const stats = taskStats(
    task,
    input,
    task.endDate ?? project?.deadline ?? null,
  );
  const pending = pendingReviews(task, input).map(s => ({ ...s, task }));
  const target = targetOn(task, today) ?? task.targets[task.targets.length - 1];
  const color = categoryColor(task.color);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];
  const cur = stats.current;

  const history = [
    ...data.reports
      .filter(r => r.taskId === task.id)
      .map(r => ({ kind: 'report' as const, day: r.day, at: r.reportedAt, r })),
    ...data.reviews
      .filter(r => r.taskId === task.id)
      .map(r => ({
        kind: 'review' as const,
        day: r.periodEnd,
        at: r.createdAt,
        r,
      })),
  ].sort((a, b) =>
    a.day === b.day ? (a.at < b.at ? 1 : -1) : a.day < b.day ? 1 : -1,
  );
  const shown = showAll ? history : history.slice(0, HISTORY_PAGE);

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
      >
        <Card testID="task-summary">
          <View style={[styles.row, { gap: spacing.md }]}>
            <Avatar
              icon={task.icon}
              imageUri={task.imageUri}
              color={task.color}
              size={56}
            />
            <View style={[styles.flex, styles.gap2]}>
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
                    style={[typography.caption, { color: colors.primaryText }]}
                  >
                    {t('life.inProject', { name: project.name })}
                  </Text>
                </Pressable>
              ) : null}
              <Badge
                label={t(`life.taskStatus_${task.status}`)}
                color={color}
              />
            </View>
          </View>
          <View style={[styles.gap2, { marginTop: spacing.sm }]}>
            <Text style={body} testID="task-target">
              {t('life.targetLabelValue', {
                target: describe(target, task.unit),
              })}
            </Text>
            <Text style={caption}>
              {t('life.unitValue', { unit: task.unit })}
            </Text>
            <Text style={caption} testID="task-dates">
              {t('life.taskDates', {
                start: formatLongDay(task.startDate),
                end: task.endDate
                  ? formatLongDay(task.endDate)
                  : t('life.noEndDate'),
              })}
            </Text>
          </View>
        </Card>

        <View style={[styles.wrap, { gap: spacing.sm }]}>
          <StatCard
            label={t('life.statCurrent')}
            value={cur ? `${cur.percent}%` : '–'}
            tone={cur?.met ? 'success' : undefined}
            testID="task-stat-current"
          />
          <StatCard
            label={t('life.statMet')}
            value={String(stats.met)}
            tone="success"
            testID="task-stat-met"
          />
          <StatCard
            label={t('life.statMissed')}
            value={String(stats.missed)}
            tone={stats.missed ? 'warning' : undefined}
            testID="task-stat-missed"
          />
          <StatCard
            label={t('life.statStreak')}
            value={String(streak(task, input))}
            testID="task-stat-streak"
          />
        </View>

        <Card testID="task-current">
          {cur ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('life.currentPeriod', {
                  range: formatPeriod(cur.start, cur.end),
                })}
              </Text>
              <Text style={body}>
                {t('life.completedLine', {
                  done: formatQty(cur.completed),
                  target: formatQty(cur.target.quantity),
                  unit: task.unit,
                })}
              </Text>
              <ProgressBar
                percent={cur.percent}
                color={cur.met ? colors.success : color}
              />
              <Text style={caption} testID="task-deadline">
                {t('life.deadlineIn', {
                  time: formatDuration(cur.closesAt.getTime() - now.getTime()),
                  day: formatDay(cur.end),
                })}
              </Text>
              <Button
                size="sm"
                iconName="check"
                label={t('life.logProgress')}
                onPress={() => setLogging(task)}
                testID="task-detail-log"
              />
            </View>
          ) : (
            <Text style={caption} testID="task-deadline">
              {stats.next
                ? t('life.nextTarget', { day: formatLongDay(stats.next.start) })
                : t('life.notRunning')}
            </Text>
          )}
          {stats.overall ? (
            <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('life.overallLine', {
                  actual: Math.round(stats.overall.actualPercent),
                  target: Math.round(stats.overall.targetPercent),
                })}
              </Text>
              <ProgressBar
                percent={stats.overall.actualPercent}
                color={color}
              />
              <Text style={caption}>
                {t('life.overallHint', {
                  done: formatQty(stats.overall.actual),
                  total: formatQty(stats.overall.plannedTotal),
                  unit: task.unit,
                })}
              </Text>
            </View>
          ) : null}
        </Card>

        {pending.length ? (
          <Notice
            tone="warning"
            title={t('life.pendingTitle')}
            message={t('life.taskPendingCount', { count: pending.length })}
            testID="task-pending"
          />
        ) : null}
        {pending.slice(0, 5).map(item => (
          <Button
            key={item.start}
            size="sm"
            variant="soft"
            label={`${t('life.giveReason')} · ${formatPeriod(
              item.start,
              item.end,
            )}`}
            onPress={() => setReviewing(item)}
            testID={`task-reason-${item.start}`}
          />
        ))}

        {task.description || task.notes ? (
          <Card testID="task-notes">
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('life.notes')}
            </Text>
            {task.description ? (
              <Text style={body}>{task.description}</Text>
            ) : null}
            {task.notes ? <Text style={caption}>{task.notes}</Text> : null}
          </Card>
        ) : null}

        <TaskCalendarCard task={task} input={input} />
        <TaskChartCard task={task} input={input} />

        <Card testID="task-history">
          <Text style={[typography.title, { color: colors.textPrimary }]}>
            {t('life.taskHistory')}
          </Text>
          {history.length === 0 ? (
            <Text style={caption} testID="task-history-empty">
              {t('life.taskHistoryEmpty')}
            </Text>
          ) : null}
          {shown.map(h =>
            h.kind === 'report' ? (
              <View
                key={h.r.id}
                style={[
                  styles.item,
                  {
                    borderTopColor: colors.divider,
                    paddingVertical: spacing.xs,
                  },
                ]}
              >
                <Text style={body}>
                  {formatDay(h.r.day)} · {formatQty(h.r.quantity)} {task.unit}
                </Text>
                {h.r.note ? <Text style={caption}>“{h.r.note}”</Text> : null}
                {h.r.edits.length ? (
                  <Text style={caption}>{t('life.editedBadge')}</Text>
                ) : null}
              </View>
            ) : (
              <View
                key={h.r.id}
                style={[
                  styles.item,
                  {
                    borderTopColor: colors.divider,
                    paddingVertical: spacing.xs,
                  },
                ]}
              >
                <Text style={[typography.body, { color: colors.warning }]}>
                  {formatPeriod(h.r.periodStart, h.r.periodEnd)} ·{' '}
                  {t('life.reasonLine', {
                    reason: t(`life.reason_${h.r.reason}`),
                  })}
                </Text>
                <Text style={caption}>
                  {t('life.dayTargetDone', {
                    target: formatQty(h.r.targetQuantity),
                    done: formatQty(h.r.completedQuantity),
                    unit: task.unit,
                  })}
                  {h.r.note ? ` — ${h.r.note}` : ''}
                </Text>
              </View>
            ),
          )}
          {history.length > HISTORY_PAGE ? (
            <Button
              size="sm"
              variant="ghost"
              label={showAll ? t('life.showLess') : t('life.showAll')}
              onPress={() => setShowAll(v => !v)}
              testID="task-history-more"
            />
          ) : null}
        </Card>

        <Button
          variant="secondary"
          iconName="pencil"
          label={t('life.edit')}
          onPress={() =>
            navigation.navigate(ROUTES.LIFE_TASK_FORM, {
              projectId: task.projectId,
              taskId: task.id,
            })
          }
          testID="task-detail-edit"
        />
      </ScrollView>
      <LogProgressSheet
        task={logging}
        today={today}
        onClose={() => setLogging(null)}
      />
      <ReviewSheet
        item={reviewing}
        today={today}
        onClose={() => setReviewing(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  item: { borderTopWidth: StyleSheet.hairlineWidth },
  gap2: { gap: 2 },
});
