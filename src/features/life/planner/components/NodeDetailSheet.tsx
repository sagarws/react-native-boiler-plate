import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Slider } from '@/shared/components';
import { useTheme } from '@/theme';
import { useLifeData } from '../../hooks/useLife';
import { currentState } from '../../services/periods';
import { projectProgress } from '../../services/analytics';
import { plannerActions, useLabels, usePlannerData } from '../hooks/usePlanner';
import type { NodeProgress } from '../services/plannerProgress';
import type { DayKey, LongTermNode } from '../types';
import { plannerFiles } from '../services/plannerFiles.service';
import { Chips } from './Chips';
import { ProgressRing } from './NodeCard';
import { formatDate, spanBetween } from '../services/plannerFormat';

export type NodeAction =
  | 'edit'
  | 'addChild'
  | 'addMilestone'
  | 'focus'
  | 'timeline'
  | 'delete';

/**
 * Everything about one node, over the map (the canvas keeps its zoom and
 * position underneath): dates, remaining time, progress and descendant
 * counts, linked Manage Life progress, children, notes and progress
 * updates, attachments — with quick status changes and actions.
 */
export function NodeDetailSheet({
  node,
  progress,
  today,
  onClose,
  onSelect,
  onAction,
}: {
  node: LongTermNode | null;
  progress: NodeProgress | undefined;
  today: DayKey;
  onClose: () => void;
  /** Go to another node (parent / child) on the canvas. */
  onSelect: (id: string) => void;
  onAction: (action: NodeAction, node: LongTermNode) => void;
}) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const data = usePlannerData();
  const life = useLifeData();
  const labels = useLabels(data);
  const [note, setNote] = useState('');
  const [update, setUpdate] = useState<number | null>(null);
  if (!node) return null;

  const parent = node.parentId
    ? data.nodes.find(n => n.id === node.parentId)
    : null;
  const children = data.nodes
    .filter(n => n.parentId === node.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const notes = data.notes
    .filter(n => n.nodeId === node.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const status = labels.status(node.statusId);
  const category = labels.category(node.categoryId);
  const color = labels.nodeColor(node);
  const caption = [typography.caption, { color: colors.textSecondary }];
  const body = [typography.body, { color: colors.textPrimary }];
  const label = [typography.label, { color: colors.textPrimary }];
  const value = progress?.value ?? null;
  const done = status.kind === 'completed' || status.kind === 'ignored';
  const span = spanBetween(today, node.targetDate);

  // Linked Manage Life record (read-only; never changed from here).
  let linked: string | null = null;
  if (node.link?.type === 'task') {
    const task = life.tasks.find(x => x.id === node.link!.id);
    const s = task
      ? currentState(task, {
          reports: life.reports,
          reviews: life.reviews,
          today,
        })
      : null;
    linked = task
      ? t('planner.linkedTask', { name: task.name, percent: s ? s.percent : 0 })
      : t('planner.linkMissing');
  } else if (node.link?.type === 'project') {
    const p = life.projects.find(x => x.id === node.link!.id);
    const pr = p ? projectProgress(life, p, today) : null;
    linked = p
      ? t('planner.linkedProject', { name: p.name, rate: pr?.targetRate ?? 0 })
      : t('planner.linkMissing');
  }

  const statusOptions = data.statuses
    .filter(s => s.isActive)
    .map(s => ({
      value: s.id,
      label: labels.status(s.id).name,
      color: labels.status(s.id).color,
    }));

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
        <Pressable style={styles.flex} onPress={onClose} accessible={false} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: bottom + spacing.md,
            },
          ]}
          testID="node-detail"
        >
          <View
            style={[
              styles.row,
              {
                padding: spacing.lg,
                paddingBottom: spacing.sm,
                gap: spacing.md,
              },
            ]}
          >
            {value !== null ? (
              <ProgressRing
                percent={value}
                size={56}
                thickness={6}
                color={color}
                track={colors.surfaceMuted}
                hole={colors.background}
              >
                <Text style={label}>{Math.round(value)}%</Text>
              </ProgressRing>
            ) : null}
            <View style={styles.flex}>
              <Text
                style={[typography.title, { color: colors.textPrimary }]}
                accessibilityRole="header"
              >
                {node.name}
              </Text>
              <Text style={caption}>
                {node.kind === 'milestone'
                  ? `${t('planner.kind_milestone')} · `
                  : ''}
                {status.name} · {category.name}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.close}
              testID="node-detail-close"
            >
              <Icon name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              gap: spacing.md,
              paddingBottom: spacing.lg,
            }}
          >
            {node.description ? (
              <Text style={body}>{node.description}</Text>
            ) : null}
            {parent ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelect(parent.id)}
                testID="node-detail-parent"
              >
                <Text
                  style={[typography.caption, { color: colors.primaryText }]}
                >
                  {t('planner.parentIs', { name: parent.name })}
                </Text>
              </Pressable>
            ) : null}

            <View style={{ gap: spacing.xs }}>
              <Text style={body}>
                {t('planner.dateRange', {
                  start: formatDate(node.startDate),
                  end: `${node.dateEstimated ? '~' : ''}${formatDate(
                    node.targetDate,
                  )}`,
                })}
                {node.dateEstimated ? ` · ${t('planner.estimatedShort')}` : ''}
              </Text>
              {node.actualCompletedAt ? (
                <Text style={caption}>
                  {t('planner.completedOn', {
                    date: formatDate(node.actualCompletedAt),
                  })}
                </Text>
              ) : null}
              {!done ? (
                <Text
                  style={[caption, span.past && { color: colors.error }]}
                  testID="node-detail-remaining"
                >
                  {span.past
                    ? t('planner.overdueBy', {
                        span: t('planner.span', { ...span }),
                      })
                    : t('planner.timeLeft', {
                        span: t('planner.span', { ...span }),
                      })}
                </Text>
              ) : null}
              {progress && progress.total ? (
                <Text style={caption}>
                  {t('planner.descendants', {
                    completed: progress.completed,
                    active: progress.active,
                    overdue: progress.overdue,
                  })}
                </Text>
              ) : null}
              {linked ? <Text style={caption}>{linked}</Text> : null}
              <Text style={caption}>
                {t('planner.lastUpdated', {
                  date: new Date(node.updatedAt).toLocaleString(),
                })}
              </Text>
            </View>

            <Text style={label}>{t('planner.changeStatus')}</Text>
            <Chips
              options={statusOptions}
              value={node.statusId}
              onChange={id => plannerActions.setNodeStatus(node.id, id, today)}
              accessibilityLabel={t('planner.changeStatus')}
              testID="node-detail-status"
            />

            <View style={[styles.wrap, { gap: spacing.sm }]}>
              <Button
                size="sm"
                label={t('planner.edit')}
                iconName="pencil"
                onPress={() => onAction('edit', node)}
                testID="node-detail-edit"
              />
              <Button
                size="sm"
                variant="secondary"
                label={t('planner.addChild')}
                iconName="plus"
                onPress={() => onAction('addChild', node)}
                testID="node-detail-add"
              />
              <Button
                size="sm"
                variant="secondary"
                label={t('planner.addMilestone')}
                iconName="mapPin"
                onPress={() => onAction('addMilestone', node)}
              />
              <Button
                size="sm"
                variant="ghost"
                label={t('planner.focusNode')}
                iconName="crosshair"
                onPress={() => onAction('focus', node)}
                testID="node-detail-focus"
              />
              <Button
                size="sm"
                variant="ghost"
                label={t('planner.viewTimeline')}
                iconName="history"
                onPress={() => onAction('timeline', node)}
              />
              {node.parentId ? (
                <Button
                  size="sm"
                  variant="danger"
                  label={t('planner.delete')}
                  onPress={() => onAction('delete', node)}
                  testID="node-detail-delete"
                />
              ) : null}
            </View>

            {children.length ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={label}>
                  {t('planner.children', { count: children.length })}
                </Text>
                {children.map(c => (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    onPress={() => onSelect(c.id)}
                    style={[styles.row, { gap: spacing.sm }]}
                    testID={`node-detail-child-${c.id}`}
                  >
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: labels.nodeColor(c) },
                      ]}
                    />
                    <Text style={[body, styles.flex]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={caption}>
                      {labels.status(c.statusId).name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {node.notes ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={label}>{t('planner.notes')}</Text>
                <Text style={body}>{node.notes}</Text>
              </View>
            ) : null}

            {node.attachments.length ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={label}>{t('planner.attachments')}</Text>
                {node.attachments.map(a => (
                  <Pressable
                    key={a.uri}
                    accessibilityRole="button"
                    onPress={() => plannerFiles.open(a)}
                    style={[styles.row, { gap: spacing.sm }]}
                  >
                    <Icon
                      name="fileText"
                      size={18}
                      color={colors.textSecondary}
                    />
                    <Text style={[body, styles.flex]} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={{ gap: spacing.sm }}>
              <Text style={label}>{t('planner.notesAndUpdates')}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('planner.notePlaceholder')}
                placeholderTextColor={colors.placeholder}
                multiline
                maxLength={2000}
                style={[
                  typography.body,
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.border,
                    borderRadius: radius.md,
                    padding: spacing.sm,
                  },
                ]}
                accessibilityLabel={t('planner.notePlaceholder')}
                testID="node-note-input"
              />
              {update !== null ? (
                <Slider
                  value={update}
                  min={0}
                  max={100}
                  step={5}
                  onChange={setUpdate}
                  accessibilityLabel={t('planner.progress')}
                  accessibilityValueText={`${update}%`}
                />
              ) : null}
              <View style={[styles.row, { gap: spacing.sm }]}>
                <Button
                  size="sm"
                  label={
                    update !== null
                      ? t('planner.saveUpdate', { percent: update })
                      : t('planner.addNote')
                  }
                  disabled={!note.trim() && update === null}
                  onPress={() => {
                    plannerActions.addNote(node.id, note, update);
                    setNote('');
                    setUpdate(null);
                  }}
                  testID="node-note-save"
                />
                {update === null ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    label={t('planner.addProgressUpdate')}
                    onPress={() => setUpdate(node.progress)}
                    testID="node-progress-update"
                  />
                ) : null}
              </View>
              {notes.map(n => (
                <View
                  key={n.id}
                  style={[
                    styles.note,
                    {
                      borderColor: colors.border,
                      borderRadius: radius.md,
                      padding: spacing.sm,
                    },
                  ]}
                >
                  <Text style={caption}>
                    {new Date(n.createdAt).toLocaleDateString()}
                    {n.type === 'progress' && n.progress !== null
                      ? ` · ${t('planner.progressNote', {
                          percent: n.progress,
                        })}`
                      : ''}
                  </Text>
                  <Text style={body}>{n.content}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: { borderWidth: 1, minHeight: 64, textAlignVertical: 'top' },
  note: { borderWidth: StyleSheet.hairlineWidth },
});
