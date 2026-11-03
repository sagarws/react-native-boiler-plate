import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  Notice,
  Slider,
  ToggleSwitch,
} from '@/shared/components';
import { pickAttachment, pickPicture } from '@/shared/utils/pickFile';
import { requestNotificationPermission } from '@/shared/utils';
import { categoryColor, useTheme } from '@/theme';
import { FormField } from '../../components/form';
import { ColorPicker, DateField, IconPicker } from '../../components/pickers';
import { useLifeData } from '../../hooks/useLife';
import { plannerActions, useLabels, usePlannerData } from '../hooks/usePlanner';
import type { NodeInput, PlannerError } from '../store/planner.store';
import type {
  Attachment,
  DayKey,
  LongTermNode,
  NodeKind,
  NodeLink,
  Priority,
} from '../types';
import { formatDate } from '../services/plannerFormat';
import { Chips } from './Chips';

const OTHER = '__other__';
const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];

export interface NodeFormTarget {
  /** Editing this node… */
  node?: LongTermNode;
  /** …or adding a child (or sibling) under this parent. */
  parent?: LongTermNode;
  kind?: NodeKind;
}

/**
 * Add / edit a mind-map node. Required: name, start and target dates,
 * status, category, colour. Everything else sits under "More details".
 * Custom statuses and categories ("Other") are saved for reuse. Dates
 * outside the parent's range, or a target before the start, ask for an
 * explicit confirmation instead of being changed silently.
 */
export function NodeFormSheet({
  target,
  today,
  onClose,
  onSaved,
}: {
  target: NodeFormTarget | null;
  today: DayKey;
  onClose: () => void;
  onSaved: (node: LongTermNode) => void;
}) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const data = usePlannerData();
  const life = useLifeData();
  const labels = useLabels(data);
  const editing = target?.node;
  const parent =
    target?.parent ??
    (editing?.parentId
      ? data.nodes.find(n => n.id === editing.parentId)
      : undefined);

  const blank = (): NodeInput & {
    customStatus: string;
    customStatusColor: string;
    customCategory: string;
    customCategoryColor: string;
    reminderDay: DayKey | null;
    reminderClock: string;
  } => ({
    name: '',
    kind: target?.kind ?? 'node',
    startDate: parent
      ? parent.startDate > today
        ? parent.startDate
        : today < parent.targetDate
        ? today
        : parent.startDate
      : today,
    targetDate: parent?.targetDate ?? today,
    statusId: 'pending',
    categoryId: 'mandatory',
    color: '',
    description: '',
    icon: '',
    imageUri: '',
    priority: 'medium',
    notes: '',
    effort: '',
    progress: 0,
    weight: 1,
    actualCompletedAt: null,
    dateEstimated: false,
    link: null,
    attachments: [],
    customStatus: '',
    customStatusColor: 'pink',
    customCategory: '',
    customCategoryColor: 'orange',
    reminderDay: null,
    reminderClock: '09:00',
  });
  const [form, setForm] = useState(blank);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<PlannerError | null>(null);
  const [linking, setLinking] = useState(false);
  const [reminderError, setReminderError] = useState(false);

  useEffect(() => {
    if (!target) return;
    setError(null);
    setMore(false);
    if (editing) {
      setForm({
        ...blank(),
        name: editing.name,
        kind: editing.kind,
        startDate: editing.startDate,
        targetDate: editing.targetDate,
        statusId: editing.statusId,
        categoryId: editing.categoryId,
        color: editing.color,
        description: editing.description,
        icon: editing.icon,
        imageUri: editing.imageUri,
        priority: editing.priority,
        notes: editing.notes,
        effort: editing.effort,
        progress: editing.progress,
        weight: editing.weight,
        actualCompletedAt: editing.actualCompletedAt,
        dateEstimated: editing.dateEstimated,
        rangeConfirmed: editing.rangeConfirmed,
        link: editing.link,
        attachments: editing.attachments,
        reminderDay: editing.reminderAt
          ? editing.reminderAt.slice(0, 10)
          : null,
        reminderClock: editing.reminderAt
          ? editing.reminderAt.slice(11, 16)
          : '09:00',
      });
    } else {
      setForm(blank());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  if (!target) return null;
  const set = (patch: Partial<typeof form>) => {
    setForm(f => ({ ...f, ...patch }));
    setError(null);
    setReminderError(false);
  };
  const statusKind = labels.status(form.statusId).kind;
  const caption = [typography.caption, { color: colors.textSecondary }];
  const label = [typography.label, { color: colors.textPrimary }];

  const statusOptions = [
    ...data.statuses
      .filter(s => s.isActive)
      .map(s => ({
        value: s.id,
        label: labels.status(s.id).name,
        color: categoryColor(s.color),
      })),
    { value: OTHER, label: t('planner.other') },
  ];
  const categoryOptions = [
    ...data.categories
      .filter(c => c.isActive)
      .map(c => ({
        value: c.id,
        label: labels.category(c.id).name,
        color: categoryColor(c.color),
      })),
    { value: OTHER, label: t('planner.other') },
  ];

  const save = (overrides: Partial<NodeInput> = {}) => {
    let reminderAt: string | null = null;
    if (form.reminderDay) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.reminderClock.trim())) {
        setReminderError(true);
        return;
      }
      reminderAt = `${form.reminderDay}T${form.reminderClock.trim()}`;
      // Ask once (Android 13+); the reminder is saved either way.
      requestNotificationPermission();
    }
    let statusId = form.statusId;
    let categoryId = form.categoryId;
    if (statusId === OTHER) {
      const s = plannerActions.addStatus(
        form.customStatus,
        form.customStatusColor,
      );
      if (!s.ok) return setError(s.error);
      statusId = s.value.id;
    }
    if (categoryId === OTHER) {
      const c = plannerActions.addCategory(
        form.customCategory,
        form.customCategoryColor,
      );
      if (!c.ok) return setError(c.error);
      categoryId = c.value.id;
    }
    const input: NodeInput = {
      ...form,
      statusId,
      categoryId,
      reminderAt,
      ...overrides,
    };
    const result = editing
      ? plannerActions.updateNode(editing.id, input)
      : parent
      ? plannerActions.addNode(parent.id, input)
      : null;
    if (!result) return;
    if (result.ok) {
      onSaved(result.value);
      return;
    }
    if (result.error === 'outside_parent' && parent) {
      Alert.alert(
        t('planner.outsideParentTitle'),
        t('planner.outsideParentBody', {
          start: formatDate(parent.startDate),
          end: formatDate(parent.targetDate),
        }),
        [
          { text: t('life.cancel'), style: 'cancel' },
          {
            text: t('planner.keepDates'),
            onPress: () => save({ ...overrides, rangeConfirmed: true }),
          },
        ],
      );
      return;
    }
    if (result.error === 'dates_reversed') {
      Alert.alert(t('planner.reversedTitle'), t('planner.reversedBody'), [
        { text: t('life.cancel'), style: 'cancel' },
        {
          text: t('planner.saveAnyway'),
          onPress: () => save({ ...overrides, allowReversed: true }),
        },
      ]);
      return;
    }
    setError(result.error);
  };

  const linkName = (link: NodeLink | null | undefined) => {
    if (!link) return null;
    return link.type === 'task'
      ? life.tasks.find(x => x.id === link.id)?.name ?? t('planner.linkMissing')
      : life.projects.find(x => x.id === link.id)?.name ??
          t('planner.linkMissing');
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.scrim, { backgroundColor: colors.overlay }]}>
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
        >
          <View
            style={[
              styles.row,
              { padding: spacing.lg, paddingBottom: spacing.sm },
            ]}
          >
            <View style={styles.flex}>
              <Text
                style={[typography.title, { color: colors.textPrimary }]}
                accessibilityRole="header"
              >
                {editing
                  ? t('planner.editNode')
                  : form.kind === 'milestone'
                  ? t('planner.addMilestone')
                  : t('planner.addChild')}
              </Text>
              {parent ? (
                <Text style={caption} numberOfLines={1}>
                  {t('planner.underParent', { name: parent.name })}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.close}
              testID="node-form-close"
            >
              <Icon name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              gap: spacing.md,
              paddingBottom: spacing.lg,
            }}
          >
            <FormField
              label={t('planner.nodeName')}
              value={form.name}
              onChangeText={name => set({ name })}
              maxLength={120}
              autoFocus={!editing}
              testID="node-name"
            />
            <Chips
              options={[
                { value: 'node', label: t('planner.kind_node') },
                { value: 'milestone', label: t('planner.kind_milestone') },
              ]}
              value={form.kind ?? 'node'}
              onChange={v => set({ kind: v as NodeKind })}
              accessibilityLabel={t('planner.kindLabel')}
              testID="node-kind"
            />
            <View style={[styles.row, { gap: spacing.sm }]}>
              <View style={styles.flex}>
                <DateField
                  label={t('planner.startDate')}
                  value={form.startDate}
                  onChange={d => d && set({ startDate: d })}
                  today={today}
                  yearNav
                  testID="node-start"
                />
              </View>
              <View style={styles.flex}>
                <DateField
                  label={t('planner.targetDate')}
                  value={form.targetDate}
                  onChange={d => d && set({ targetDate: d })}
                  today={today}
                  yearNav
                  testID="node-target"
                />
              </View>
            </View>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Text style={[label, styles.flex]}>{t('planner.estimated')}</Text>
              <ToggleSwitch
                isOn={!!form.dateEstimated}
                onToggle={v => set({ dateEstimated: v })}
                accessibilityLabel={t('planner.estimated')}
              />
            </View>

            <Text style={label}>{t('planner.status')}</Text>
            <Chips
              options={statusOptions}
              value={form.statusId}
              onChange={statusId => set({ statusId })}
              accessibilityLabel={t('planner.status')}
              testID="node-status"
            />
            {form.statusId === OTHER ? (
              <View style={{ gap: spacing.sm }}>
                <FormField
                  label={t('planner.customStatus')}
                  value={form.customStatus}
                  onChangeText={customStatus => set({ customStatus })}
                  maxLength={40}
                  testID="node-custom-status"
                />
                <ColorPicker
                  value={form.customStatusColor}
                  onChange={customStatusColor => set({ customStatusColor })}
                  testID="node-custom-status-color"
                />
              </View>
            ) : null}
            {statusKind === 'running' ||
            statusKind === 'other' ||
            form.statusId === OTHER ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={label}>
                  {t('planner.progressValue', { percent: form.progress ?? 0 })}
                </Text>
                <Slider
                  value={form.progress ?? 0}
                  min={0}
                  max={100}
                  step={5}
                  onChange={progress => set({ progress })}
                  accessibilityLabel={t('planner.progress')}
                  accessibilityValueText={`${form.progress ?? 0}%`}
                  testID="node-progress"
                />
              </View>
            ) : null}

            <Text style={label}>{t('planner.category')}</Text>
            <Chips
              options={categoryOptions}
              value={form.categoryId}
              onChange={categoryId => set({ categoryId })}
              accessibilityLabel={t('planner.category')}
              testID="node-category"
            />
            {form.categoryId === OTHER ? (
              <View style={{ gap: spacing.sm }}>
                <FormField
                  label={t('planner.customCategory')}
                  value={form.customCategory}
                  onChangeText={customCategory => set({ customCategory })}
                  maxLength={40}
                  testID="node-custom-category"
                />
                <ColorPicker
                  value={form.customCategoryColor}
                  onChange={customCategoryColor => set({ customCategoryColor })}
                  testID="node-custom-category-color"
                />
              </View>
            ) : null}

            <Text style={label}>{t('planner.color')}</Text>
            <View style={[styles.row, { gap: spacing.sm }]}>
              <Button
                size="sm"
                variant={form.color ? 'ghost' : 'soft'}
                label={t('planner.colorAuto')}
                onPress={() => set({ color: '' })}
                testID="node-color-auto"
              />
            </View>
            <ColorPicker
              value={form.color ?? ''}
              onChange={color => set({ color })}
              testID="node-color"
            />

            <Button
              variant="ghost"
              size="sm"
              label={more ? t('planner.lessDetails') : t('planner.moreDetails')}
              onPress={() => setMore(m => !m)}
              testID="node-more"
            />
            {more ? (
              <View style={{ gap: spacing.md }}>
                <FormField
                  label={t('planner.description')}
                  value={form.description}
                  onChangeText={description => set({ description })}
                  multiline
                  maxLength={2000}
                />
                <Text style={label}>{t('planner.icon')}</Text>
                <IconPicker
                  value={form.icon ?? ''}
                  color={form.color || 'violet'}
                  onChange={icon => set({ icon })}
                  testID="node-icon"
                />
                <View style={[styles.row, { gap: spacing.sm }]}>
                  {form.imageUri ? (
                    <Image
                      source={{ uri: form.imageUri }}
                      style={[styles.thumb, { borderRadius: radius.md }]}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="secondary"
                    label={
                      form.imageUri
                        ? t('planner.changePicture')
                        : t('planner.addPicture')
                    }
                    onPress={async () => {
                      const uri = await pickPicture();
                      if (uri) set({ imageUri: uri });
                    }}
                  />
                  {form.imageUri ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t('planner.remove')}
                      onPress={() => set({ imageUri: '' })}
                    />
                  ) : null}
                </View>
                <Text style={label}>{t('planner.priority')}</Text>
                <Chips
                  options={PRIORITIES.map(p => ({
                    value: p,
                    label: t(`life.priority_${p}`),
                  }))}
                  value={form.priority ?? 'medium'}
                  onChange={p => set({ priority: p as Priority })}
                  accessibilityLabel={t('planner.priority')}
                  testID="node-priority"
                />
                <View style={[styles.row, { gap: spacing.sm }]}>
                  <View style={styles.flex}>
                    <FormField
                      label={t('planner.effort')}
                      value={form.effort}
                      onChangeText={effort => set({ effort })}
                      maxLength={80}
                      placeholder={t('planner.effortPlaceholder')}
                    />
                  </View>
                  <View style={styles.flex}>
                    <FormField
                      label={t('planner.weight')}
                      value={String(form.weight ?? 1)}
                      onChangeText={w =>
                        set({ weight: Number(w.replace(',', '.')) || 0 })
                      }
                      keyboardType="decimal-pad"
                      hint={t('planner.weightHint')}
                    />
                  </View>
                </View>
                <DateField
                  label={t('planner.actualCompleted')}
                  value={form.actualCompletedAt ?? null}
                  onChange={d => set({ actualCompletedAt: d })}
                  today={today}
                  allowClear
                  emptyLabel={t('planner.notCompletedYet')}
                  yearNav
                  testID="node-completed"
                />
                <FormField
                  label={t('planner.notes')}
                  value={form.notes}
                  onChangeText={notes => set({ notes })}
                  multiline
                  maxLength={2000}
                />

                <Text style={label}>{t('planner.link')}</Text>
                <Text style={caption}>
                  {form.link
                    ? t('planner.linkedTo', { name: linkName(form.link) })
                    : t('planner.linkHint')}
                </Text>
                <View style={[styles.row, { gap: spacing.sm }]}>
                  <Button
                    size="sm"
                    variant="secondary"
                    label={
                      form.link ? t('planner.changeLink') : t('planner.addLink')
                    }
                    onPress={() => setLinking(true)}
                    testID="node-link"
                  />
                  {form.link ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      label={t('planner.remove')}
                      onPress={() => set({ link: null })}
                    />
                  ) : null}
                </View>
                {linking ? (
                  <View
                    style={[
                      styles.linkBox,
                      {
                        borderColor: colors.border,
                        borderRadius: radius.md,
                        padding: spacing.sm,
                        gap: spacing.xs,
                      },
                    ]}
                  >
                    {life.projects.length === 0 ? (
                      <Text style={caption}>{t('planner.noLifeItems')}</Text>
                    ) : null}
                    {life.projects.map(p => (
                      <View key={p.id} style={{ gap: spacing.xs }}>
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => {
                            set({ link: { type: 'project', id: p.id } });
                            setLinking(false);
                          }}
                          testID={`link-project-${p.id}`}
                        >
                          <Text style={label}>{p.name}</Text>
                        </Pressable>
                        {life.tasks
                          .filter(
                            x =>
                              x.projectId === p.id && x.status !== 'archived',
                          )
                          .map(task => (
                            <Pressable
                              key={task.id}
                              accessibilityRole="button"
                              onPress={() => {
                                set({ link: { type: 'task', id: task.id } });
                                setLinking(false);
                              }}
                              style={{ paddingLeft: spacing.md }}
                              testID={`link-task-${task.id}`}
                            >
                              <Text
                                style={[
                                  typography.body,
                                  { color: colors.textPrimary },
                                ]}
                              >
                                {task.name}
                              </Text>
                            </Pressable>
                          ))}
                      </View>
                    ))}
                  </View>
                ) : null}

                <Text style={label}>{t('planner.reminder')}</Text>
                <Text style={caption}>{t('planner.reminderHint')}</Text>
                <View style={[styles.row, { gap: spacing.sm }]}>
                  <View style={styles.flex}>
                    <DateField
                      label={t('planner.reminder')}
                      value={form.reminderDay}
                      onChange={reminderDay => set({ reminderDay })}
                      today={today}
                      allowClear
                      emptyLabel={t('planner.reminderNone')}
                      yearNav
                      testID="node-reminder-day"
                    />
                  </View>
                  {form.reminderDay ? (
                    <View style={styles.flex}>
                      <FormField
                        label={t('planner.reminderTime')}
                        value={form.reminderClock}
                        onChangeText={reminderClock => set({ reminderClock })}
                        maxLength={5}
                        keyboardType="numbers-and-punctuation"
                        testID="node-reminder-time"
                      />
                    </View>
                  ) : null}
                </View>
                {reminderError ? (
                  <Notice
                    tone="error"
                    message={t('planner.error_reminder_time')}
                    testID="node-reminder-error"
                  />
                ) : null}

                <Text style={label}>{t('planner.attachments')}</Text>
                {(form.attachments ?? []).map((a: Attachment) => (
                  <View key={a.uri} style={[styles.row, { gap: spacing.sm }]}>
                    <Icon
                      name="fileText"
                      size={18}
                      color={colors.textSecondary}
                    />
                    <Text
                      style={[
                        typography.body,
                        styles.flex,
                        { color: colors.textPrimary },
                      ]}
                      numberOfLines={1}
                    >
                      {a.name}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('planner.remove')}
                      onPress={() =>
                        set({
                          attachments: (form.attachments ?? []).filter(
                            x => x.uri !== a.uri,
                          ),
                        })
                      }
                    >
                      <Icon name="x" size={18} color={colors.textSecondary} />
                    </Pressable>
                  </View>
                ))}
                <Button
                  size="sm"
                  variant="secondary"
                  iconName="plus"
                  label={t('planner.addAttachment')}
                  onPress={async () => {
                    const file = await pickAttachment();
                    if (file)
                      set({
                        attachments: [
                          ...(form.attachments ?? []),
                          { uri: file.uri, name: file.name, mime: file.mime },
                        ],
                      });
                  }}
                />
              </View>
            ) : null}

            {error ? (
              <Notice
                tone="error"
                message={t(`planner.error_${error}`)}
                testID="node-form-error"
              />
            ) : null}
            <Button
              label={t('planner.save')}
              iconName="check"
              onPress={() => save()}
              disabled={!form.name.trim()}
              testID="node-save"
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 48, height: 48 },
  linkBox: { borderWidth: 1 },
});
