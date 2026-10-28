import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, EmptyState, SegmentedControl } from '@/shared/components';
import { useTheme } from '@/theme';
import { projectProgress } from '../../services/analytics';
import type { Project } from '../../types';
import { ProjectCard } from '../ProjectCard';
import type { TabProps } from './shared';

type Filter = 'active' | 'completed' | 'archived' | 'overdue';
type Sort = 'deadline' | 'updated' | 'name';

/** Projects with status filters, sorting and search (names, tasks, notes). */
export function ProjectsTab({
  data,
  today,
  onOpenProject,
  onNewProject,
}: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [filter, setFilter] = useState<Filter>('active');
  const [sort, setSort] = useState<Sort>('deadline');
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = (p: Project) => {
    if (!q) return true;
    const tasks = data.tasks.filter(x => x.projectId === p.id);
    const ids = new Set(tasks.map(x => x.id));
    return (
      [p.name, p.description, p.objective, p.notes, p.category].some(s =>
        s.toLowerCase().includes(q),
      ) ||
      tasks.some(x => x.name.toLowerCase().includes(q)) ||
      data.reports.some(
        r => ids.has(r.taskId) && r.note.toLowerCase().includes(q),
      ) ||
      data.reviews.some(
        r => ids.has(r.taskId) && r.note.toLowerCase().includes(q),
      )
    );
  };
  const list = data.projects
    .filter(p =>
      filter === 'overdue'
        ? p.status === 'active' && p.deadline < today
        : p.status === filter,
    )
    .filter(matches)
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'updated'
        ? a.updatedAt < b.updatedAt
          ? 1
          : -1
        : a.deadline < b.deadline
        ? -1
        : 1,
    );

  return (
    <View style={{ gap: spacing.md }}>
      <Button
        iconName="layers"
        label={t('life.newProject')}
        onPress={onNewProject}
        testID="projects-new"
      />
      <TextInput
        testID="projects-search"
        accessibilityLabel={t('life.searchPlaceholder')}
        placeholder={t('life.searchPlaceholder')}
        placeholderTextColor={colors.placeholder}
        value={query}
        onChangeText={setQuery}
        style={[
          typography.body,
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          },
        ]}
      />
      <SegmentedControl
        testID="projects-filter"
        accessibilityLabel={t('life.tab_projects')}
        value={filter}
        onChange={setFilter}
        options={(['active', 'completed', 'archived', 'overdue'] as const).map(
          f => ({ value: f, label: t(`life.filter_${f}`) }),
        )}
      />
      <SegmentedControl
        testID="projects-sort"
        accessibilityLabel={t('life.sort')}
        value={sort}
        onChange={setSort}
        options={(['deadline', 'updated', 'name'] as const).map(s => ({
          value: s,
          label: t(`life.sort_${s}`),
        }))}
      />
      {list.length ? (
        list.map(p => (
          <ProjectCard
            key={p.id}
            project={p}
            progress={projectProgress(data, p, today)}
            onPress={x => onOpenProject(x.id)}
          />
        ))
      ) : (
        <EmptyState
          compact
          icon="layers"
          title={t('life.noProjects')}
          testID="projects-empty"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, minHeight: 48 },
});
