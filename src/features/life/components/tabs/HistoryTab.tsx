import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  SegmentedControl,
  TabBar,
} from '@/shared/components';
import { useTheme } from '@/theme';
import {
  allPendingReviews,
  endedStates,
  liveTasks,
} from '../../services/analytics';
import type { DayKey, IncompleteReason, LifeData, Task } from '../../types';
import { addDays } from '../../utils/dates';
import { formatDay, formatPeriod, formatQty } from '../../utils/format';
import { ProjectChips } from './ProjectChips';
import type { TabProps } from './shared';

type Kind = 'all' | 'reasons' | 'success' | 'missed' | 'pending';
type Range = '7' | '30' | '90' | 'all';

export interface HistoryEntry {
  key: string;
  kind: 'progress' | 'reason' | 'met' | 'pending';
  task: Task;
  start: DayKey;
  end: DayKey;
  completed: number;
  target: number;
  percent: number;
  note: string;
  reason: IncompleteReason | null;
  updatedAt: string;
}

/** History entries for the filters (pure, so it is unit-tested). */
export function historyEntries(
  data: LifeData,
  today: DayKey,
  kind: Kind,
  from: DayKey,
  projectId: string | null,
  query: string,
): HistoryEntry[] {
  const tasks = data.tasks.filter(t => !projectId || t.projectId === projectId);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const q = query.trim().toLowerCase();
  const out: HistoryEntry[] = [];
  if (kind === 'all') {
    for (const r of data.reports) {
      const task = byId.get(r.taskId);
      if (!task || r.day < from) continue;
      out.push({
        key: `p${r.id}`,
        kind: 'progress',
        task,
        start: r.day,
        end: r.day,
        completed: r.quantity,
        target: 0,
        percent: 0,
        note: r.note,
        reason: null,
        updatedAt: r.updatedAt,
      });
    }
  }
  if (kind === 'all' || kind === 'reasons' || kind === 'missed') {
    for (const v of data.reviews) {
      const task = byId.get(v.taskId);
      if (!task || v.periodEnd < from) continue;
      const percent =
        v.targetQuantity > 0
          ? Math.min(
              100,
              Math.round((v.completedQuantity / v.targetQuantity) * 100),
            )
          : 0;
      out.push({
        key: `v${v.id}`,
        kind: 'reason',
        task,
        start: v.periodStart,
        end: v.periodEnd,
        completed: v.completedQuantity,
        target: v.targetQuantity,
        percent,
        note: v.note,
        reason: v.reason,
        updatedAt: v.updatedAt,
      });
    }
  }
  if (kind === 'success') {
    const live = liveTasks(data, projectId ?? undefined);
    for (const s of endedStates(
      live,
      { reports: data.reports, reviews: data.reviews, today },
      from,
      addDays(today, -1),
    )) {
      if (s.status !== 'achieved') continue;
      const task = live.find(t => t.id === s.taskId)!;
      out.push({
        key: `m${s.taskId}${s.start}`,
        kind: 'met',
        task,
        start: s.start,
        end: s.end,
        completed: s.completed,
        target: s.target.quantity,
        percent: s.percent,
        note: '',
        reason: null,
        updatedAt: s.end,
      });
    }
  }
  if (kind === 'pending') {
    for (const s of allPendingReviews(data, today)) {
      if ((projectId && s.task.projectId !== projectId) || s.end < from)
        continue;
      out.push({
        key: `q${s.task.id}${s.start}`,
        kind: 'pending',
        task: s.task,
        start: s.start,
        end: s.end,
        completed: s.completed,
        target: s.target.quantity,
        percent: s.percent,
        note: '',
        reason: null,
        updatedAt: s.end,
      });
    }
  }
  return out
    .filter(
      e =>
        !q ||
        [e.task.name, e.note, e.reason ?? ''].some(s =>
          s.toLowerCase().includes(q),
        ),
    )
    .sort((a, b) =>
      a.end === b.end
        ? a.updatedAt < b.updatedAt
          ? 1
          : -1
        : a.end < b.end
        ? 1
        : -1,
    );
}

/** CSV of the entries (shared as text). */
export function toCsv(
  entries: HistoryEntry[],
  projectName: (id: string) => string,
): string {
  const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    [
      'type',
      'project',
      'task',
      'start',
      'end',
      'completed',
      'target',
      'unit',
      'percent',
      'reason',
      'note',
    ],
  ];
  for (const e of entries) {
    rows.push([
      e.kind,
      projectName(e.task.projectId),
      e.task.name,
      e.start,
      e.end,
      String(e.completed),
      String(e.target || ''),
      e.task.unit,
      String(e.percent || ''),
      e.reason ?? '',
      e.note,
    ]);
  }
  return rows.map(r => r.map(cell).join(',')).join('\n');
}

/** Notes, reasons, met / missed / pending periods — filtered, searchable, exportable. */
export function HistoryTab({ data, today, onReview, onOpenProject }: TabProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [kind, setKind] = useState<Kind>('all');
  const [range, setRange] = useState<Range>('30');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const from = range === 'all' ? '0000-01-01' : addDays(today, -Number(range));
  const entries = useMemo(
    () => historyEntries(data, today, kind, from, projectId, query),
    [data, today, kind, from, projectId, query],
  );
  const caption = [typography.caption, { color: colors.textSecondary }];
  const projectName = (id: string) =>
    data.projects.find(p => p.id === id)?.name ?? '';

  return (
    <View style={{ gap: spacing.md }}>
      <TabBar
        scrollable
        testID="history-kind"
        accessibilityLabel={t('life.tab_history')}
        value={kind}
        onChange={setKind}
        tabs={(['all', 'reasons', 'success', 'missed', 'pending'] as const).map(
          k => ({
            value: k,
            label: t(`life.history_${k}`),
          }),
        )}
      />
      <SegmentedControl
        testID="history-range"
        accessibilityLabel={t('life.insightsRange')}
        value={range}
        onChange={setRange}
        options={(['7', '30', '90', 'all'] as const).map(r => ({
          value: r,
          label: t(`life.range_${r}`),
        }))}
      />
      <ProjectChips
        projects={data.projects}
        value={projectId}
        onChange={setProjectId}
        testID="history-project"
      />
      <TextInput
        testID="history-search"
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
      {entries.length ? (
        <Button
          size="sm"
          variant="soft"
          iconName="share2"
          label={t('life.export')}
          onPress={() => {
            void Share.share({
              title: t('life.exportTitle'),
              message: toCsv(entries, projectName),
            });
          }}
          testID="history-export"
        />
      ) : null}
      <FlatList
        scrollEnabled={false}
        data={entries}
        keyExtractor={e => e.key}
        initialNumToRender={20}
        ListEmptyComponent={
          <EmptyState
            compact
            icon="history"
            title={t('life.historyEmpty')}
            testID="history-empty"
          />
        }
        renderItem={({ item: e }) => (
          <View
            testID={`history-${e.key}`}
            style={[
              styles.item,
              {
                borderBottomColor: colors.divider,
                paddingVertical: spacing.sm,
                gap: spacing.xs / 2,
              },
            ]}
          >
            <Text
              style={[typography.label, { color: colors.textPrimary }]}
              onPress={() => onOpenProject(e.task.projectId)}
            >
              {projectName(e.task.projectId)} · {e.task.name}
            </Text>
            <Text style={caption}>
              {e.kind === 'progress'
                ? formatDay(e.start)
                : formatPeriod(e.start, e.end)}{' '}
              ·{' '}
              {e.kind === 'progress'
                ? `${t('life.progressEntry')}: ${formatQty(e.completed)} ${
                    e.task.unit
                  }`
                : `${formatQty(e.completed)} / ${formatQty(e.target)} ${
                    e.task.unit
                  } (${e.percent}%)`}
            </Text>
            {e.reason ? (
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                {t(`life.reason_${e.reason}`)}
              </Text>
            ) : null}
            {e.note ? (
              <Text style={[typography.body, { color: colors.textPrimary }]}>
                “{e.note}”
              </Text>
            ) : null}
            {e.kind === 'pending' ? (
              <Button
                size="sm"
                variant="soft"
                label={t('life.giveReason')}
                onPress={() => {
                  const item = allPendingReviews(data, today).find(
                    s => s.task.id === e.task.id && s.start === e.start,
                  );
                  if (item) onReview(item);
                }}
              />
            ) : null}
            {e.kind === 'progress' || e.kind === 'reason' ? (
              <Text style={caption}>
                {t('life.updated', {
                  date: new Date(e.updatedAt).toLocaleString([], {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </Text>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, minHeight: 48 },
  item: { borderBottomWidth: StyleSheet.hairlineWidth },
});
