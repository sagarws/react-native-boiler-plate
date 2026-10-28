import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card, EmptyState } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import {
  allPendingReviews,
  dailyTrend,
  dashboardSummary,
  projectProgress,
} from '../../services/analytics';
import { addDays } from '../../utils/dates';
import { formatDay, formatPeriod } from '../../utils/format';
import { BarChart } from '../charts';
import { ProgressBar, StatCard } from '../visuals';
import type { TabProps } from './shared';

/** Overview: summary numbers, reports needed, project progress, 14-day trend. */
export function DashboardTab({
  data,
  today,
  onReview,
  onOpenProject,
  onNewProject,
  onTab,
}: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();

  if (!data.projects.length) {
    return (
      <EmptyState
        icon="gauge"
        title={t('life.emptyTitle')}
        message={t('life.emptyBody')}
        action={{ label: t('life.newProject'), onPress: onNewProject }}
        testID="life-empty"
      />
    );
  }

  const s = dashboardSummary(data, today);
  const pending = allPendingReviews(data, today);
  const trend = dailyTrend(data, addDays(today, -13), today, today);
  const active = data.projects.filter(p => p.status === 'active');
  const dash = t('life.noValue');
  const label = [typography.title, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <View style={{ gap: spacing.lg }}>
      <View style={[styles.grid, { gap: spacing.sm }]}>
        <StatCard
          label={t('life.stat_activeProjects')}
          value={String(s.activeProjects)}
          onPress={() => onTab('projects')}
          testID="stat-projects"
        />
        <StatCard
          label={t('life.stat_activeTasks')}
          value={String(s.activeTasks)}
          testID="stat-tasks"
        />
        <StatCard
          label={t('life.stat_doneToday')}
          value={
            s.dueToday
              ? t('life.stat_doneTodayValue', {
                  done: s.doneToday,
                  due: s.dueToday,
                })
              : dash
          }
          tone={
            s.dueToday && s.doneToday === s.dueToday ? 'success' : undefined
          }
          onPress={() => onTab('today')}
          testID="stat-today"
        />
        <StatCard
          label={t('life.stat_reportsRequired')}
          value={String(s.reportsRequired)}
          tone={s.reportsRequired ? 'warning' : undefined}
          testID="stat-reports"
        />
        <StatCard
          label={t('life.stat_weekly')}
          value={s.weeklyRate === null ? dash : `${s.weeklyRate}%`}
          onPress={() => onTab('insights')}
          testID="stat-weekly"
        />
        <StatCard
          label={t('life.stat_overdue')}
          value={String(s.overdueProjects)}
          tone={s.overdueProjects ? 'warning' : undefined}
          testID="stat-overdue"
        />
        <StatCard
          label={t('life.stat_streak')}
          value={
            s.bestStreak
              ? t('life.stat_streakValue', { count: s.bestStreak })
              : dash
          }
          testID="stat-streak"
        />
        <StatCard
          label={t('life.stat_todayPercent')}
          value={s.todayPercent === null ? dash : `${s.todayPercent}%`}
          testID="stat-today-percent"
        />
      </View>
      <Text style={caption}>{t('life.metricHelp')}</Text>

      {pending.length ? (
        <Card testID="life-pending">
          <Text style={label}>{t('life.pendingTitle')}</Text>
          <Text style={[caption, { marginBottom: spacing.sm }]}>
            {t('life.pendingHint')}
          </Text>
          {pending.slice(0, 6).map(item => (
            <View
              key={`${item.task.id}-${item.start}`}
              style={[
                styles.row,
                { paddingVertical: spacing.xs, gap: spacing.sm },
              ]}
            >
              <Text
                style={[
                  typography.body,
                  styles.flex,
                  { color: colors.textPrimary },
                ]}
                numberOfLines={2}
              >
                {t('life.pendingItem', {
                  task: item.task.name,
                  period: formatPeriod(item.start, item.end),
                })}
              </Text>
              <Button
                size="sm"
                variant="soft"
                label={t('life.giveReason')}
                onPress={() => onReview(item)}
                testID={`pending-${item.task.id}-${item.start}`}
              />
            </View>
          ))}
          {pending.length > 6 ? (
            <Button
              size="sm"
              variant="ghost"
              label={`+${pending.length - 6}`}
              onPress={() => onTab('history')}
            />
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Text style={[label, { marginBottom: spacing.sm }]}>
          {t('life.projectProgressTitle')}
        </Text>
        <View style={{ gap: spacing.md }}>
          {active.map(p => {
            const prog = projectProgress(data, p, today);
            return (
              <Pressable
                key={p.id}
                onPress={() => onOpenProject(p.id)}
                accessibilityRole="button"
                accessibilityLabel={p.name}
                style={{ gap: spacing.xs }}
              >
                <View style={styles.row}>
                  <Text
                    style={[
                      typography.label,
                      styles.flex,
                      { color: colors.textPrimary },
                    ]}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                  <Text style={caption}>
                    {prog.targetRate === null ? dash : `${prog.targetRate}%`}
                  </Text>
                </View>
                <ProgressBar
                  percent={prog.targetRate ?? 0}
                  color={categoryColor(p.color)}
                />
                <Text style={caption}>
                  {t('life.timeUsed', { percent: prog.timePercent })} ·{' '}
                  {prog.overdue
                    ? t('life.overdueBy', { count: -prog.daysLeft })
                    : t('life.daysLeft', { count: Math.max(0, prog.daysLeft) })}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card>
        <Text style={label}>{t('life.trendTitle')}</Text>
        <Text style={[caption, { marginBottom: spacing.sm }]}>
          {t('life.trendHint')}
        </Text>
        <BarChart
          testID="dashboard-trend"
          emptyText={t('life.noEndedPeriods')}
          points={trend.map(p => ({
            label: p.day.slice(8),
            value: p.rate,
            a11y: `${formatDay(p.day)}: ${
              p.rate === null ? dash : `${p.rate}%`
            }`,
            onPress: () => onTab('calendar'),
          }))}
        />
      </Card>

      <Button
        iconName="sparkles"
        label={t('life.getRecommendations')}
        onPress={() => onTab('insights')}
        testID="dashboard-ai"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
});
