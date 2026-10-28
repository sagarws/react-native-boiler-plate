import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { useDescribeTarget } from '../hooks/useLife';
import type { PeriodState } from '../services/periods';
import type { Task } from '../types';
import { formatDuration } from '../utils/dates';
import { formatPeriod, formatQty } from '../utils/format';
import { Avatar, ProgressBar } from './visuals';

export interface TaskCardProps {
  task: Task;
  /** Today's period, or null when the task isn't running today. */
  state: PeriodState | null;
  now: Date;
  today: string;
  onLog: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onToggleFocus?: (task: Task) => void;
  streak?: number;
}

/**
 * One measurable task: today's period, target, done, remaining, time left
 * in the period and a one-tap "Log progress". The project's own deadline is
 * shown elsewhere — this countdown is only the current target period.
 */
export function TaskCard({
  task,
  state,
  now,
  today,
  onLog,
  onOpen,
  onToggleFocus,
  streak,
}: TaskCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const describe = useDescribeTarget();
  const color = categoryColor(task.color);
  const focused = task.focusDay === today;
  const caption = [typography.caption, { color: colors.textSecondary }];

  let line = t('life.notRunning');
  if (state) {
    if (state.exceeded) {
      line = t('life.exceededLine', {
        extra: formatQty(state.completed - state.target.quantity),
        unit: task.unit,
      });
    } else if (state.met) line = t('life.metLine');
    else
      line = t('life.remainingLine', {
        remaining: formatQty(state.remaining),
        unit: task.unit,
      });
  }

  return (
    <View
      testID={`task-card-${task.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: color,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.sm,
        },
      ]}
    >
      <Pressable
        disabled={!onOpen}
        onPress={() => onOpen?.(task)}
        style={[styles.row, { gap: spacing.md }]}
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={task.name}
      >
        <Avatar
          icon={task.icon}
          imageUri={task.imageUri}
          color={task.color}
          size={40}
        />
        <View style={styles.flex}>
          <Text
            style={[typography.label, { color: colors.textPrimary }]}
            numberOfLines={2}
          >
            {task.name}
          </Text>
          <Text style={caption} numberOfLines={1}>
            {state ? describe(state.target, task.unit) : t('life.notRunning')}
            {task.status === 'paused' ? ` · ${t('life.paused')}` : ''}
            {streak && streak > 1
              ? ` · ${t('life.streakBadge', { count: streak })}`
              : ''}
          </Text>
        </View>
        {onToggleFocus ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={focused ? t('life.unfocus') : t('life.focus')}
            onPress={() => onToggleFocus(task)}
            hitSlop={8}
            testID={`task-focus-${task.id}`}
            style={styles.iconButton}
          >
            <Icon
              name="sparkles"
              size={20}
              color={focused ? colors.warning : colors.border}
            />
          </Pressable>
        ) : null}
      </Pressable>

      {state && state.status !== 'paused' ? (
        <>
          <View style={styles.row}>
            <Text
              style={[
                typography.label,
                styles.flex,
                { color: colors.textPrimary },
              ]}
              testID={`task-done-${task.id}`}
            >
              {t('life.completedLine', {
                done: formatQty(state.completed),
                target: formatQty(state.target.quantity),
                unit: task.unit,
              })}
            </Text>
            <Text style={caption}>
              {state.start === state.end && state.start === today
                ? t('life.periodToday')
                : formatPeriod(state.start, state.end)}
            </Text>
          </View>
          <ProgressBar
            percent={state.percent}
            color={state.met ? colors.success : color}
          />
          <View style={styles.row}>
            <Text
              style={[
                caption,
                styles.flex,
                state.met && { color: colors.success },
              ]}
              numberOfLines={1}
            >
              {line}
            </Text>
            <Text style={caption} testID={`task-left-${task.id}`}>
              {t('life.timeLeft', {
                time: formatDuration(state.closesAt.getTime() - now.getTime()),
              })}
            </Text>
          </View>
          <Button
            size="sm"
            iconName="check"
            label={t('life.logProgress')}
            onPress={() => onLog(task)}
            testID={`task-log-${task.id}`}
            style={{ marginTop: spacing.xs }}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderLeftWidth: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
