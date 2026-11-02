import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { categoryColor, useTheme } from '@/theme';
import { reportsIn } from '../services/periods';
import { percentOf, type ProjectDay, type TaskDay } from '../services/progress';
import type { ProgressReport, Task } from '../types';
import { formatLongDay, formatPeriod, formatQty } from '../utils/format';
import { ProgressBar } from './visuals';

/** What a tapped day on the task calendar holds. */
export function TaskDayDetail({
  task,
  day,
  reports,
}: {
  task: Task;
  day: TaskDay | undefined;
  reports: readonly ProgressReport[];
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];
  if (!day) return null;
  const s = day.state;
  if (!s) {
    return (
      <View testID="task-day-detail" style={{ gap: spacing.xs }}>
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {formatLongDay(day.day)}
        </Text>
        <Text style={caption}>{t('life.dayNoTarget')}</Text>
      </View>
    );
  }
  const notes = reportsIn(s, reports).filter(r => r.note);
  return (
    <View testID="task-day-detail" style={{ gap: spacing.xs }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {formatLongDay(day.day)}
      </Text>
      <Text style={caption}>
        {t('life.periodOf', { range: formatPeriod(s.start, s.end) })} ·{' '}
        {t(`life.status_${s.status}`)}
      </Text>
      <Text style={body}>
        {t('life.dayProgress', {
          done: formatQty(s.completed),
          target: formatQty(s.target.quantity),
          unit: task.unit,
          percent: percentOf(s.ratio),
        })}
      </Text>
      {!s.hasReports && s.status !== 'upcoming' ? (
        <Text style={caption}>{t('life.notReported')}</Text>
      ) : null}
      <ProgressBar
        percent={percentOf(s.ratio)}
        color={s.met ? colors.success : categoryColor(task.color)}
      />
      {notes.map(r => (
        <Text key={r.id} style={caption}>
          “{r.note}”
        </Text>
      ))}
      {s.review ? (
        <Text style={body}>
          {t('life.dayReason', {
            reason: t(`life.reason_${s.review.reason}`),
          })}
          {s.review.note ? ` — ${s.review.note}` : ''}
        </Text>
      ) : null}
    </View>
  );
}

/** Per-task breakdown of a tapped day on the project calendar. */
export function ProjectDayDetail({
  day,
  onOpenTask,
}: {
  day: ProjectDay | undefined;
  onOpenTask: (task: Task) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const caption = [typography.caption, { color: colors.textSecondary }];
  if (!day) return null;
  return (
    <View testID="project-day-detail" style={{ gap: spacing.sm }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {formatLongDay(day.day)}
      </Text>
      {day.scheduled.length === 0 ? (
        <Text style={caption}>{t('life.dayNoTarget')}</Text>
      ) : (
        <>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {day.percent === null
              ? t('life.dayNothingReported')
              : t('life.dayAverage', {
                  percent: day.percent,
                  count: day.scheduled.length,
                })}
          </Text>
          {day.scheduled.map(({ task, state }) => (
            <Pressable
              key={task.id}
              onPress={() => onOpenTask(task)}
              accessibilityRole="button"
              accessibilityHint={t('life.openTaskHint')}
              style={{ gap: spacing.xs }}
              testID={`project-day-task-${task.id}`}
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
                  {task.name}
                </Text>
                <Text style={caption}>
                  {state.hasReports
                    ? `${percentOf(state.ratio)}%`
                    : t('life.notReportedShort')}
                </Text>
              </View>
              <Text style={caption}>
                {formatQty(state.completed)} /{' '}
                {formatQty(state.target.quantity)} {task.unit} ·{' '}
                {formatPeriod(state.start, state.end)}
              </Text>
              <ProgressBar
                percent={percentOf(state.ratio)}
                color={state.met ? colors.success : categoryColor(task.color)}
              />
            </Pressable>
          ))}
          <Text style={caption}>{t('life.dayAverageHow')}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
