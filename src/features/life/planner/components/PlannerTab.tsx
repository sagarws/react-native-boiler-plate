import React, { useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ROUTES } from '@/navigation/routes';
import type { MainStackParamList } from '@/navigation/types';
import { Button, Card, EmptyState } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import { DateField } from '../../components/pickers';
import { Avatar, ProgressBar, StatCard } from '../../components/visuals';
import { plannerActions, usePlannerData } from '../hooks/usePlanner';
import { formatDate, yearRange } from '../services/plannerFormat';
import {
  milestones,
  nextMilestone,
  plannerSummary,
  projectProgressValue,
  searchNodes,
  sortProjects,
  type MilestoneFilter,
  type ProjectSort,
} from '../services/plannerQueries';
import type { DayKey, LongTermProject, PlanStatus } from '../types';
import { Chips } from './Chips';

const SORTS: readonly ProjectSort[] = ['updated', 'name', 'target', 'progress'];
const FILTERS: readonly MilestoneFilter[] = [
  'upcoming',
  'thisYear',
  'next5',
  'next10',
  'overdue',
  'completed',
  'custom',
];

/**
 * Manage Life → Long-Term Planner: summary, projects (search, sort,
 * status filter, archive / duplicate / delete), recently edited plans and
 * the milestone list across all plans.
 */
export function PlannerTab({ today }: { today: DayKey }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const data = usePlannerData();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>('updated');
  const [status, setStatus] = useState<PlanStatus>('active');
  const [filter, setFilter] = useState<MilestoneFilter>('upcoming');
  const [range, setRange] = useState<{ from: DayKey; to: DayKey }>({
    from: today,
    to: `${Number(today.slice(0, 4)) + 10}-12-31`,
  });
  const summary = useMemo(() => plannerSummary(data, today), [data, today]);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const label = [typography.label, { color: colors.textPrimary }];

  const q = query.trim().toLowerCase();
  const projects = sortProjects(
    data,
    data.projects.filter(
      p => p.status === status && (!q || p.name.toLowerCase().includes(q)),
    ),
    sort,
    today,
  );
  const nodeHits = q ? searchNodes(data, q, 12) : [];
  const rows = milestones(data, filter, today, range).slice(0, 30);

  const open = (projectId: string, focusNodeId?: string) =>
    navigation.navigate(ROUTES.PLANNER_MAP, { projectId, focusNodeId });

  const actions = (p: LongTermProject) =>
    Alert.alert(p.name, undefined, [
      { text: t('planner.open'), onPress: () => open(p.id) },
      {
        text: t('planner.edit'),
        onPress: () =>
          navigation.navigate(ROUTES.PLANNER_PROJECT_FORM, { projectId: p.id }),
      },
      {
        text: t('planner.duplicate'),
        onPress: () =>
          plannerActions.duplicateProject(p.id, t('planner.copySuffix')),
      },
      p.status === 'active'
        ? {
            text: t('planner.markProjectCompleted'),
            onPress: () => plannerActions.setProjectStatus(p.id, 'completed'),
          }
        : {
            text: t('planner.reactivate'),
            onPress: () => plannerActions.setProjectStatus(p.id, 'active'),
          },
      ...(p.status !== 'archived'
        ? [
            {
              text: t('planner.archive'),
              onPress: () => plannerActions.setProjectStatus(p.id, 'archived'),
            },
          ]
        : []),
      {
        text: t('planner.delete'),
        style: 'destructive' as const,
        onPress: () =>
          Alert.alert(
            t('planner.deleteProjectTitle', { name: p.name }),
            t('planner.deleteProjectBody', {
              count: data.nodes.filter(n => n.projectId === p.id).length - 1,
            }),
            [
              { text: t('life.cancel'), style: 'cancel' },
              {
                text: t('planner.delete'),
                style: 'destructive',
                onPress: () => plannerActions.deleteProject(p.id),
              },
            ],
          ),
      },
      { text: t('life.cancel'), style: 'cancel' },
    ]);

  return (
    <View style={{ gap: spacing.md }} testID="planner-tab">
      <View style={[styles.wrap, { gap: spacing.sm }]}>
        <StatCard
          label={t('planner.statTotal')}
          value={String(summary.total)}
          testID="planner-stat-total"
        />
        <StatCard
          label={t('planner.statActive')}
          value={String(summary.active)}
        />
        <StatCard
          label={t('planner.statCompleted')}
          value={String(summary.completed)}
          tone="success"
        />
        <StatCard
          label={t('planner.statUpcoming')}
          value={String(summary.upcomingMilestones)}
        />
        <StatCard
          label={t('planner.statOverdue')}
          value={String(summary.overdueMilestones)}
          tone={summary.overdueMilestones ? 'warning' : undefined}
        />
        <StatCard
          label={t('planner.statOverall')}
          value={summary.overall === null ? '–' : `${summary.overall}%`}
        />
      </View>
      <Button
        label={t('planner.createProject')}
        iconName="plus"
        onPress={() => navigation.navigate(ROUTES.PLANNER_PROJECT_FORM, {})}
        testID="planner-create"
      />

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('planner.searchPlansPlaceholder')}
        placeholderTextColor={colors.placeholder}
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
        accessibilityLabel={t('planner.searchPlansPlaceholder')}
        testID="planner-search"
      />
      {nodeHits.length ? (
        <Card testID="planner-node-hits">
          <View style={{ gap: spacing.xs }}>
            <Text style={label}>{t('planner.nodeResults')}</Text>
            {nodeHits.map(h => (
              <Pressable
                key={h.node.id}
                accessibilityRole="button"
                onPress={() => open(h.project.id, h.node.id)}
                testID={`planner-hit-${h.node.id}`}
              >
                <Text style={[typography.body, { color: colors.textPrimary }]}>
                  {h.node.name}
                </Text>
                <Text style={caption} numberOfLines={1}>
                  {[h.project.name, ...h.path.slice(1)].join(' › ')}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      <Chips
        options={(['active', 'completed', 'archived'] as const).map(s => ({
          value: s,
          label: t(`planner.planStatus_${s}`),
        }))}
        value={status}
        onChange={v => setStatus(v as PlanStatus)}
        accessibilityLabel={t('planner.statusFilter')}
        testID="planner-status"
      />
      <Chips
        options={SORTS.map(s => ({ value: s, label: t(`planner.sort_${s}`) }))}
        value={sort}
        onChange={v => setSort(v as ProjectSort)}
        accessibilityLabel={t('planner.sortLabel')}
        testID="planner-sort"
      />

      {projects.length === 0 ? (
        <EmptyState
          icon="compass"
          title={
            data.projects.length
              ? t('planner.noMatch')
              : t('planner.emptyTitle')
          }
          message={data.projects.length ? undefined : t('planner.emptyMessage')}
          compact
          testID="planner-empty"
        />
      ) : (
        projects.map(p => {
          const value = projectProgressValue(data, p, today);
          const count = data.nodes.filter(n => n.projectId === p.id).length - 1;
          const next = nextMilestone(data, p.id, today);
          return (
            <Pressable
              key={p.id}
              onPress={() => open(p.id)}
              onLongPress={() => actions(p)}
              accessibilityRole="button"
              accessibilityHint={t('planner.cardHint')}
              testID={`plan-${p.id}`}
            >
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <View style={[styles.row, { gap: spacing.md }]}>
                    <Avatar
                      icon={p.icon}
                      imageUri={p.imageUri}
                      color={p.color}
                      size={48}
                    />
                    <View style={styles.flex}>
                      <Text style={label} numberOfLines={2}>
                        {p.name}
                      </Text>
                      <Text style={caption}>
                        {yearRange(p.startDate, p.targetDate)}
                        {p.targetEstimated
                          ? ` · ${t('planner.estimatedShort')}`
                          : ''}{' '}
                        · {t(`planner.planStatus_${p.status}`)}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('planner.moreActions')}
                      onPress={() => actions(p)}
                      hitSlop={spacing.sm}
                      testID={`plan-actions-${p.id}`}
                    >
                      <Text
                        style={[
                          typography.title,
                          { color: colors.textSecondary },
                        ]}
                      >
                        ⋯
                      </Text>
                    </Pressable>
                  </View>
                  <ProgressBar
                    percent={value ?? 0}
                    color={categoryColor(p.color)}
                  />
                  <Text style={caption}>
                    {value === null
                      ? t('planner.noProgressYet')
                      : t('planner.percentDone', {
                          percent: Math.round(value),
                        })}{' '}
                    · {t('planner.nodeCount', { count })}
                  </Text>
                  {next ? (
                    <Text style={caption} numberOfLines={1}>
                      {t('planner.nextMilestone', {
                        name: next.name,
                        date: formatDate(next.targetDate),
                      })}
                    </Text>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          );
        })
      )}

      {summary.recent.length ? (
        <Card>
          <View style={{ gap: spacing.xs }}>
            <Text style={label}>{t('planner.recent')}</Text>
            {summary.recent.map(p => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                onPress={() => open(p.id)}
                style={styles.row}
              >
                <Text
                  style={[
                    typography.body,
                    styles.flex,
                    { color: colors.textPrimary },
                  ]}
                  numberOfLines={1}
                >
                  {p.name}
                </Text>
                <Text style={caption}>
                  {new Date(p.updatedAt).toLocaleDateString()}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      <Card testID="planner-milestones">
        <View style={{ gap: spacing.sm }}>
          <Text style={label}>{t('planner.milestonesTitle')}</Text>
          <Chips
            options={FILTERS.map(f => ({
              value: f,
              label: t(`planner.filter_${f}`),
            }))}
            value={filter}
            onChange={v => setFilter(v as MilestoneFilter)}
            accessibilityLabel={t('planner.milestonesTitle')}
            testID="milestone-filter"
          />
          {filter === 'custom' ? (
            <View style={[styles.row, { gap: spacing.sm }]}>
              <View style={styles.flex}>
                <DateField
                  label={t('planner.from')}
                  value={range.from}
                  onChange={d => d && setRange(r => ({ ...r, from: d }))}
                  today={today}
                  yearNav
                  testID="milestone-from"
                />
              </View>
              <View style={styles.flex}>
                <DateField
                  label={t('planner.to')}
                  value={range.to}
                  onChange={d => d && setRange(r => ({ ...r, to: d }))}
                  today={today}
                  yearNav
                  testID="milestone-to"
                />
              </View>
            </View>
          ) : null}
          {rows.length === 0 ? (
            <Text style={caption}>{t('planner.noMilestones')}</Text>
          ) : (
            rows.map(r => (
              <Pressable
                key={r.node.id}
                accessibilityRole="button"
                onPress={() => open(r.project.id, r.node.id)}
                style={[styles.row, { gap: spacing.sm }]}
                testID={`milestone-${r.node.id}`}
              >
                <View
                  style={[
                    styles.diamond,
                    { backgroundColor: categoryColor(r.project.color) },
                  ]}
                />
                <View style={styles.flex}>
                  <Text
                    style={[typography.body, { color: colors.textPrimary }]}
                    numberOfLines={1}
                  >
                    {r.node.name}
                  </Text>
                  <Text style={caption} numberOfLines={1}>
                    {r.project.name}
                  </Text>
                </View>
                <Text
                  style={[
                    typography.caption,
                    { color: r.overdue ? colors.error : colors.textSecondary },
                  ]}
                >
                  {r.node.dateEstimated ? '~' : ''}
                  {formatDate(r.node.targetDate)}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  input: { borderWidth: 1, minHeight: 44 },
  diamond: { width: 10, height: 10, transform: [{ rotate: '45deg' }] },
});
