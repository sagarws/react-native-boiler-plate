import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import type { DayMark } from '../services/analytics';
import type { ProgressLevel } from '../services/progress';
import type { DayKey } from '../types';
import {
  addDays,
  addMonths,
  daysInMonth,
  monthStart,
  startOfDay,
  weekdayMon0,
} from '../utils/dates';
import { formatLongDay, formatMonth } from '../utils/format';
import { shadeFor } from './progressShade';

/** Progress shading for one day (detail pages). */
export interface DayShadeInfo {
  level: ProgressLevel;
  /** Short value drawn under the date ("45%", "–"), or ''. */
  label: string;
  /** Read by screen readers after the date. */
  a11y: string;
}

export interface MonthCalendarProps {
  /** Any day in the month to show. */
  month: DayKey;
  onMonthChange: (month: DayKey) => void;
  selected: DayKey | null;
  onSelect: (day: DayKey) => void;
  today: DayKey;
  /** Status dot per day (calendar view); omit for a plain date picker. */
  marks?: Record<DayKey, DayMark>;
  /** Coloured dots per day (up to 3), e.g. reminder categories. */
  dots?: Record<DayKey, string[]>;
  /** Progress shading per day; replaces the dots. Needs [shadeColor]. */
  shades?: Record<DayKey, DayShadeInfo>;
  /** Base colour the shades are drawn in (the task's / project's colour). */
  shadeColor?: string;
  min?: DayKey;
  max?: DayKey;
  testID?: string;
}

/** A Monday-first month grid, used for the calendar view and as a date picker. */
export function MonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  today,
  marks,
  dots,
  shades,
  shadeColor,
  min,
  max,
  testID = 'calendar',
}: MonthCalendarProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const first = monthStart(month);
  const lead = weekdayMon0(first);
  const count = daysInMonth(first);
  const cells: (DayKey | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: count }, (_, i) => addDays(first, i)),
  ];
  while (cells.length % 7) cells.push(null);
  const markColor: Record<DayMark, string | null> = {
    none: null,
    done: colors.success,
    partial: colors.primary,
    missed: colors.error,
    pending: colors.warning,
    upcoming: colors.border,
  };
  // Mon … Sun initials in the device language.
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    startOfDay(addDays('2026-10-26', i)).toLocaleDateString([], {
      weekday: 'narrow',
    }),
  );

  return (
    <View testID={testID}>
      <View style={[styles.header, { marginBottom: spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('life.prevMonth')}
          onPress={() => onMonthChange(addMonths(first, -1))}
          style={styles.nav}
          testID={`${testID}-prev`}
        >
          <Icon name="arrowLeft" size={20} color={colors.textPrimary} />
        </Pressable>
        <Text
          style={[
            typography.title,
            styles.flex,
            styles.center,
            { color: colors.textPrimary },
          ]}
        >
          {formatMonth(first)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('life.nextMonth')}
          onPress={() => onMonthChange(addMonths(first, 1))}
          style={styles.nav}
          testID={`${testID}-next`}
        >
          <Icon name="chevronRight" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>
      <View style={styles.row}>
        {weekdays.map((w, i) => (
          <Text
            key={i}
            style={[
              typography.caption,
              styles.cell,
              styles.center,
              { color: colors.textSecondary },
            ]}
          >
            {w}
          </Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          if (!day) return <View key={`e${i}`} style={styles.cell} />;
          const disabled = (min && day < min) || (max && day > max);
          const isSelected = day === selected;
          const mark = marks?.[day];
          const dot = mark ? markColor[mark] : null;
          const shadeInfo = shades?.[day];
          const shade = shadeInfo
            ? shadeFor(shadeInfo.level, shadeColor ?? colors.primary, colors)
            : null;
          const markText =
            mark && mark !== 'none' ? `, ${t(`life.legend_${mark}`)}` : '';
          const shadeText = shadeInfo?.a11y ? `, ${shadeInfo.a11y}` : '';
          return (
            <Pressable
              key={day}
              disabled={!!disabled}
              onPress={() => onSelect(day)}
              accessibilityRole="button"
              accessibilityState={{
                selected: isSelected,
                disabled: !!disabled,
              }}
              accessibilityLabel={`${formatLongDay(
                day,
              )}${markText}${shadeText}`}
              testID={`${testID}-day-${day}`}
              style={[styles.cell, styles.dayCell]}
            >
              {shade ? (
                <View
                  testID={`${testID}-shade-${day}-${shadeInfo!.level}`}
                  style={[
                    styles.shadeBox,
                    {
                      backgroundColor: shade.backgroundColor,
                      borderColor: isSelected
                        ? colors.textPrimary
                        : day === today
                        ? colors.primary
                        : shade.borderColor,
                      borderRadius: radius.md,
                    },
                    isSelected && styles.shadeSelected,
                  ]}
                >
                  <Text
                    style={[
                      typography.label,
                      {
                        color: disabled
                          ? colors.disabledForeground
                          : shadeInfo!.level === 'none'
                          ? colors.textPrimary
                          : shade.color,
                      },
                    ]}
                  >
                    {Number(day.slice(8))}
                  </Text>
                  <Text
                    style={[styles.shadeLabel, { color: shade.color }]}
                    numberOfLines={1}
                  >
                    {shadeInfo!.label}
                  </Text>
                </View>
              ) : (
                <>
                  <View
                    style={[
                      styles.dayCircle,
                      { borderRadius: radius.pill },
                      isSelected && { backgroundColor: colors.primary },
                      !isSelected &&
                        day === today && [
                          styles.todayRing,
                          { borderColor: colors.primary },
                        ],
                    ]}
                  >
                    <Text
                      style={[
                        typography.body,
                        {
                          color: isSelected
                            ? colors.primaryForeground
                            : disabled
                            ? colors.disabledForeground
                            : colors.textPrimary,
                        },
                      ]}
                    >
                      {Number(day.slice(8))}
                    </Text>
                  </View>
                  {dots?.[day]?.length ? (
                    <View style={styles.dots} testID={`${testID}-dots-${day}`}>
                      {dots[day].slice(0, 3).map((c, k) => (
                        <View
                          key={k}
                          style={[
                            styles.dot,
                            { backgroundColor: c, borderRadius: radius.pill },
                          ]}
                        />
                      ))}
                    </View>
                  ) : (
                    <View
                      style={[
                        styles.mark,
                        {
                          backgroundColor: dot ?? 'transparent',
                          borderRadius: radius.pill,
                        },
                      ]}
                    />
                  )}
                </>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  nav: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1 },
  todayRing: { borderWidth: 1 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%` },
  dayCell: { alignItems: 'center', paddingVertical: 2, minHeight: 46 },
  dayCircle: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: { width: 6, height: 6, marginTop: 2 },
  dots: { flexDirection: 'row', gap: 2, marginTop: 2 },
  dot: { width: 6, height: 6 },
  shadeBox: {
    width: '92%',
    minHeight: 42,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Below the caption scale on purpose: it must fit a seventh of the width.
  shadeLabel: { fontSize: 9, lineHeight: 11 },
  shadeSelected: { borderWidth: 2 },
});
