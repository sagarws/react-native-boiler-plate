import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { TaskCard } from '../components/TaskCard';
import { Avatar, ProgressBar } from '../components/visuals';
import { lifeActions, useClock, useLifeData } from '../hooks/useLife';
import { projectProgress } from '../services/analytics';
import {
  currentState,
  pendingReviews,
  streak,
  type PeriodState,
} from '../services/periods';
import type { Task } from '../types';
import { formatDay, formatPeriod } from '../utils/format';

/** A project: its numbers, outstanding reasons, tasks and actions. */
export default function ProjectDetailScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'LifeProject'>>();
  const data = useLifeData();
  const { now, today } = useClock();
  const [logging, setLogging] = useState<Task | null>(null);
  const [reviewing, setReviewing] = useState<
    (PeriodState & { task: Task }) | null
  >(null);
  const project = data.projects.find(p => p.id === params.projectId);

  if (!project) {
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
          testID="project-missing"
        />
      </View>
    );
  }

  const tasks = data.tasks.filter(
    x => x.projectId === project.id && x.status !== 'archived',
  );
  const archivedTasks = data.tasks.filter(
    x => x.projectId === project.id && x.status === 'archived',
  );
  const progress = projectProgress(data, project, today);
  const input = { reports: data.reports, reviews: data.reviews, today };
  const pending = tasks.flatMap(task =>
    pendingReviews(task, input).map(s => ({ ...s, task })),
  );
  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];

  const confirmDeleteProject = () => {
    const ids = new Set(
      data.tasks.filter(x => x.projectId === project.id).map(x => x.id),
    );
    const reports =
      data.reports.filter(r => ids.has(r.taskId)).length +
      data.reviews.filter(r => ids.has(r.taskId)).length;
    Alert.alert(
      t('life.deleteProjectTitle', { name: project.name }),
      t('life.deleteProjectBody', { tasks: ids.size, reports }),
      [
        { text: t('life.cancel'), style: 'cancel' },
        {
          text: t('life.archive'),
          onPress: () => lifeActions.setProjectStatus(project.id, 'archived'),
        },
        {
          text: t('life.delete'),
          style: 'destructive',
          onPress: () => {
            lifeActions.deleteProject(project.id);
            navigation.goBack();
          },
        },
      ],
    );
  };

  const confirmDeleteTask = (task: Task) => {
    const reports =
      data.reports.filter(r => r.taskId === task.id).length +
      data.reviews.filter(r => r.taskId === task.id).length;
    Alert.alert(
      t('life.deleteTaskTitle', { name: task.name }),
      t('life.deleteTaskBody', { reports }),
      [
        { text: t('life.cancel'), style: 'cancel' },
        {
          text: t('life.archive'),
          onPress: () => lifeActions.setTaskStatus(task.id, 'archived'),
        },
        {
          text: t('life.delete'),
          style: 'destructive',
          onPress: () => lifeActions.deleteTask(task.id),
        },
      ],
    );
  };

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={project.name} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <Card testID="project-summary">
          <View style={[styles.row, { gap: spacing.md }]}>
            <Avatar
              icon={project.icon}
              imageUri={project.imageUri}
              color={project.color}
              size={56}
            />
            <View style={styles.flex}>
              <Text style={[typography.title, { color: colors.textPrimary }]}>
                {project.name}
              </Text>
              <Text style={caption}>
                {t('life.projectDates', {
                  start: formatDay(project.startDate),
                  deadline: formatDay(project.deadline),
                })}
              </Text>
              <Text
                style={[caption, progress.overdue && { color: colors.error }]}
              >
                {project.status === 'completed'
                  ? t('life.completedBadge')
                  : progress.overdue
                  ? t('life.overdueBy', { count: -progress.daysLeft })
                  : t('life.daysLeft', {
                      count: Math.max(0, progress.daysLeft),
                    })}
              </Text>
            </View>
          </View>
          {project.objective ? (
            <Text style={[body, { marginTop: spacing.sm }]}>{`${t(
              'life.objectiveLabel',
            )}: ${project.objective}`}</Text>
          ) : null}
          {project.successCriteria ? (
            <Text style={body}>{`${t('life.successLabel')}: ${
              project.successCriteria
            }`}</Text>
          ) : null}
          {project.description ? (
            <Text style={caption}>{project.description}</Text>
          ) : null}
          <View style={{ gap: spacing.xs, marginTop: spacing.sm }}>
            <ProgressBar
              percent={progress.targetRate ?? 0}
              color={categoryColor(project.color)}
            />
            <Text style={caption}>
              {progress.judgedPeriods
                ? t('life.targetsMet', {
                    met: progress.metPeriods,
                    total: progress.judgedPeriods,
                  })
                : t('life.noEndedPeriods')}{' '}
              · {t('life.timeUsed', { percent: progress.timePercent })}
            </Text>
          </View>
        </Card>

        {pending.length ? (
          <Card>
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('life.pendingTitle')}
            </Text>
            {pending.slice(0, 8).map(item => (
              <View
                key={`${item.task.id}-${item.start}`}
                style={[
                  styles.row,
                  { gap: spacing.sm, paddingVertical: spacing.xs },
                ]}
              >
                <Text style={[body, styles.flex]}>
                  {t('life.pendingItem', {
                    task: item.task.name,
                    period: formatPeriod(item.start, item.end),
                  })}
                </Text>
                <Button
                  size="sm"
                  variant="soft"
                  label={t('life.giveReason')}
                  onPress={() => setReviewing(item)}
                />
              </View>
            ))}
          </Card>
        ) : null}

        <View style={styles.row}>
          <Text
            style={[
              typography.title,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          >
            {t('life.tasksTitle')}
          </Text>
          <Button
            size="sm"
            iconName="layers"
            label={t('life.addTask')}
            onPress={() =>
              navigation.navigate(ROUTES.LIFE_TASK_FORM, {
                projectId: project.id,
              })
            }
            testID="project-add-task"
          />
        </View>
        {tasks.length === 0 ? (
          <Notice
            tone="info"
            message={t('life.noTasks')}
            testID="project-no-tasks"
          />
        ) : null}
        {tasks.map(task => (
          <View key={task.id} style={{ gap: spacing.xs }}>
            <TaskCard
              task={task}
              state={currentState(task, input)}
              now={now}
              today={today}
              onLog={setLogging}
              onToggleFocus={x =>
                lifeActions.setFocus(x.id, x.focusDay === today ? null : today)
              }
              streak={streak(task, input)}
            />
            <View style={[styles.wrap, { gap: spacing.xs }]}>
              <Button
                size="sm"
                variant="ghost"
                label={t('life.edit')}
                onPress={() =>
                  navigation.navigate(ROUTES.LIFE_TASK_FORM, {
                    projectId: project.id,
                    taskId: task.id,
                  })
                }
                testID={`task-edit-${task.id}`}
              />
              {task.status === 'paused' ? (
                <Button
                  size="sm"
                  variant="ghost"
                  label={t('life.resume')}
                  onPress={() => lifeActions.resumeTask(task.id, today)}
                  testID={`task-resume-${task.id}`}
                />
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  label={t('life.pause')}
                  onPress={() => lifeActions.pauseTask(task.id, '', today)}
                  testID={`task-pause-${task.id}`}
                />
              )}
              <Button
                size="sm"
                variant="ghost"
                label={t('life.archive')}
                onPress={() => lifeActions.setTaskStatus(task.id, 'archived')}
              />
              <Button
                size="sm"
                variant="ghost"
                label={t('life.delete')}
                onPress={() => confirmDeleteTask(task)}
                testID={`task-delete-${task.id}`}
              />
            </View>
          </View>
        ))}
        {archivedTasks.length ? (
          <Card>
            <Text style={caption}>{t('life.archivedBadge')}</Text>
            {archivedTasks.map(task => (
              <View key={task.id} style={[styles.row, { gap: spacing.sm }]}>
                <Text style={[body, styles.flex]}>{task.name}</Text>
                <Button
                  size="sm"
                  variant="ghost"
                  label={t('life.restore')}
                  onPress={() => lifeActions.setTaskStatus(task.id, 'active')}
                />
              </View>
            ))}
          </Card>
        ) : null}

        <Button
          variant="soft"
          iconName="sparkles"
          label={t('life.getRecommendations')}
          onPress={() =>
            navigation.navigate(ROUTES.MANAGE_LIFE, { tab: 'insights' })
          }
        />
        <View style={[styles.wrap, { gap: spacing.sm }]}>
          <Button
            size="sm"
            variant="secondary"
            label={t('life.edit')}
            onPress={() =>
              navigation.navigate(ROUTES.LIFE_PROJECT_FORM, {
                projectId: project.id,
              })
            }
            testID="project-edit"
          />
          {project.status === 'completed' ? (
            <Button
              size="sm"
              variant="secondary"
              label={t('life.reopen')}
              onPress={() => lifeActions.setProjectStatus(project.id, 'active')}
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              label={t('life.markCompleted')}
              onPress={() =>
                lifeActions.setProjectStatus(project.id, 'completed')
              }
              testID="project-complete"
            />
          )}
          {project.status === 'archived' ? (
            <Button
              size="sm"
              variant="secondary"
              label={t('life.restore')}
              onPress={() => lifeActions.setProjectStatus(project.id, 'active')}
              testID="project-restore"
            />
          ) : (
            <Button
              size="sm"
              variant="secondary"
              label={t('life.archive')}
              onPress={() =>
                lifeActions.setProjectStatus(project.id, 'archived')
              }
              testID="project-archive"
            />
          )}
          <Button
            size="sm"
            variant="danger"
            label={t('life.delete')}
            onPress={confirmDeleteProject}
            testID="project-delete"
          />
        </View>
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
});
