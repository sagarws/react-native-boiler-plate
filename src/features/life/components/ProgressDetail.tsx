import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import type { PeriodState } from '../services/periods';
import { PROGRESS_LEVELS } from '../services/progress';
import type { ProgressReport, Task } from '../types';
import { formatLongDay, formatPeriod, formatQty } from '../utils/format';
import type { LineStyle } from './progressCharts';
import { shadeFor } from './progressShade';
import { ProgressBar } from './visuals';

/** The calendar colour scale, with the words each colour means. */
export function ProgressLegend({ color }: { color: string }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View
      testID="progress-legend"
      style={[styles.wrap, { gap: spacing.sm, marginTop: spacing.sm }]}
    >
      {PROGRESS_LEVELS.map(level => {
        const shade = shadeFor(level, color, colors);
        return (
          <View key={level} style={[styles.row, { gap: spacing.xs }]}>
            <View
              style={[
                styles.swatch,
                {
                  backgroundColor: shade.backgroundColor,
                  borderColor:
                    level === 'none' ? colors.border : shade.borderColor,
                  borderRadius: radius.sm,
                },
              ]}
            />
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t(`life.level_${level}`)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Target, done, % complete, notes and the incomplete reason for each
 * period in [states] (the periods covering one selected day).
 */
export function PeriodBreakdown({
  day,
  states,
  reports,
  showTask,
  onOpenTask,
  testID,
}: {
  day: string;
  states: (PeriodState & { task: Task })[];
  reports: readonly ProgressReport[];
  /** Show each row's task name (project page). */
  showTask?: boolean;
  onOpenTask?: (task: Task) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const caption = [typography.caption, { color: colors.textSecondary }];
  return (
    <View testID={testID} style={{ gap: spacing.xs }}>
      <Text style={[typography.title, { color: colors.textPrimary }]}>
        {formatLongDay(day)}
      </Text>
      {states.length === 0 ? (
        <Text style={caption} testID={testID ? `${testID}-empty` : undefined}>
          {t('life.dayEmpty')}
        </Text>
      ) : null}
      {states.map(s => {
        const notes = reports.filter(
          r =>
            r.taskId === s.task.id &&
            r.day >= s.start &&
            r.day <= s.end &&
            r.note,
        );
        const percent = Math.round(s.ratio * 100);
        return (
          <View
            key={`${s.task.id}-${s.start}`}
            testID={testID ? `${testID}-${s.task.id}` : undefined}
            style={[
              styles.item,
              {
                borderTopColor: colors.divider,
                paddingTop: spacing.sm,
                gap: spacing.xs,
              },
            ]}
          >
            {showTask ? (
              <Pressable
                disabled={!onOpenTask}
                onPress={() => onOpenTask?.(s.task)}
                accessibilityRole={onOpenTask ? 'button' : undefined}
                style={[styles.row, { gap: spacing.xs }]}
              >
                <Text
                  style={[
                    typography.label,
                    styles.flex,
                    { color: colors.textPrimary },
                  ]}
                >
                  {s.task.name}
                </Text>
                {onOpenTask ? (
                  <Icon
                    name="chevronRight"
                    size={16}
                    color={colors.textSecondary}
                  />
                ) : null}
              </Pressable>
            ) : null}
            <Text style={caption}>
              {t('life.periodOf', { range: formatPeriod(s.start, s.end) })} ·{' '}
              {s.status === 'active' && s.met
                ? t('life.metLine')
                : t(`life.status_${s.status}`)}
            </Text>
            <Text style={[typography.body, { color: colors.textPrimary }]}>
              {t('life.dayTargetDone', {
                target: formatQty(s.target.quantity),
                done: formatQty(s.completed),
                unit: s.task.unit,
              })}
            </Text>
            <Text style={caption}>
              {s.hasReports
                ? t('life.dayPercent', { percent })
                : t('life.notReported')}
            </Text>
            <ProgressBar
              percent={s.percent}
              color={s.met ? colors.success : categoryColor(s.task.color)}
            />
            {notes.map(n => (
              <Text key={n.id} style={caption}>
                “{n.note}”
              </Text>
            ))}
            {s.review ? (
              <Text style={caption}>
                {t('life.reasonLine', {
                  reason: t(`life.reason_${s.review.reason}`),
                })}
                {s.review.note ? ` — ${s.review.note}` : ''}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export interface ToggleItem {
  id: string;
  label: string;
  color: string;
  style: LineStyle;
  visible: boolean;
}

/** A scrollable row of show / hide chips, one per chart line. */
export function LineToggles({
  items,
  onToggle,
  testID,
}: {
  items: ToggleItem[];
  onToggle: (id: string) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      testID={testID}
      contentContainerStyle={{ gap: spacing.xs }}
    >
      {items.map(item => (
        <Pressable
          key={item.id}
          onPress={() => onToggle(item.id)}
          accessibilityRole="switch"
          accessibilityState={{ checked: item.visible }}
          accessibilityLabel={t(
            item.visible ? 'life.chartHideLine' : 'life.chartShowLine',
            { name: item.label },
          )}
          testID={testID ? `${testID}-${item.id}` : undefined}
          style={[
            styles.row,
            styles.chip,
            {
              gap: spacing.xs,
              paddingHorizontal: spacing.sm,
              borderRadius: radius.pill,
              borderColor: item.visible ? item.color : colors.border,
            },
            item.visible && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Icon
            name={item.visible ? 'circleCheck' : 'square'}
            size={14}
            color={item.visible ? item.color : colors.textSecondary}
          />
          <View style={[styles.row, styles.lineKey]}>
            {(item.style === 'dashed' ? [0, 1] : [0]).map(k => (
              <View
                key={k}
                style={[
                  styles.flex,
                  item.style === 'bold' ? styles.keyBold : styles.keyThin,
                  item.style === 'dashed' && k === 0 && styles.dashGap,
                  { backgroundColor: item.color },
                ]}
              />
            ))}
          </View>
          <Text
            numberOfLines={1}
            style={[
              typography.caption,
              {
                color: item.visible ? colors.textPrimary : colors.textSecondary,
              },
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  swatch: { width: 14, height: 14, borderWidth: 1 },
  item: { borderTopWidth: StyleSheet.hairlineWidth },
  chip: { borderWidth: 1, minHeight: 36, maxWidth: 220 },
  lineKey: { width: 16 },
  keyBold: { height: 3 },
  keyThin: { height: 2 },
  dashGap: { marginRight: 3 },
});
