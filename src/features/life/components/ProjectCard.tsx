import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { categoryColor, useTheme } from '@/theme';
import type { ProjectProgress } from '../services/analytics';
import type { Project } from '../types';
import { Avatar, Badge, ProgressBar } from './visuals';

/** Compact project card: picture/icon, deadline, targets met, today's status. */
export function ProjectCard({
  project,
  progress,
  onPress,
}: {
  project: Project;
  progress: ProjectProgress;
  onPress: (p: Project) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const color = categoryColor(project.color);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const deadline =
    project.status === 'completed'
      ? t('life.completedBadge')
      : progress.overdue
      ? t('life.overdueBy', { count: -progress.daysLeft })
      : progress.daysLeft === 0
      ? t('life.dueToday')
      : t('life.daysLeft', { count: progress.daysLeft });

  return (
    <Pressable
      testID={`project-card-${project.id}`}
      onPress={() => onPress(project)}
      accessibilityRole="button"
      accessibilityLabel={`${project.name}, ${deadline}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.sm,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing.md }]}>
        <Avatar
          icon={project.icon}
          imageUri={project.imageUri}
          color={project.color}
        />
        <View style={styles.flex}>
          <Text
            style={[typography.label, { color: colors.textPrimary }]}
            numberOfLines={2}
          >
            {project.name}
          </Text>
          <Text
            style={[caption, progress.overdue && { color: colors.error }]}
            numberOfLines={1}
          >
            {deadline}
          </Text>
        </View>
        {project.status === 'archived' ? (
          <Badge label={t('life.archivedBadge')} color={colors.border} />
        ) : null}
        {progress.overdue ? (
          <Badge label={t('life.filter_overdue')} color={colors.error} />
        ) : null}
      </View>
      <ProgressBar percent={progress.targetRate ?? 0} color={color} />
      <View style={styles.row}>
        <Text style={[caption, styles.flex]} numberOfLines={1}>
          {progress.judgedPeriods
            ? t('life.targetsMet', {
                met: progress.metPeriods,
                total: progress.judgedPeriods,
              })
            : t('life.noEndedPeriods')}
        </Text>
        {progress.todayDue ? (
          <Text
            style={[
              caption,
              progress.todayDone === progress.todayDue && {
                color: colors.success,
              },
            ]}
          >
            {t('life.todayStatus', {
              done: progress.todayDone,
              due: progress.todayDue,
            })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
});
