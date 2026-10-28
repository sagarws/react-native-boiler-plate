import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import type { DayMark } from '../services/analytics';
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

export interface MonthCalendarProps {
  /** Any day in the month to show. */
  month: DayKey;
  onMonthChange: (month: DayKey) => void;
  selected: DayKey | null;
  onSelect: (day: DayKey) => void;
  today: DayKey;
  /** Status dot per day (calendar view); omit for a plain date picker. */
  marks?: Record<DayKey, DayMark>;
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
              accessibilityLabel={`${formatLongDay(day)}${
                mark && mark !== 'none' ? `, ${t(`life.legend_${mark}`)}` : ''
              }`}
              testID={`${testID}-day-${day}`}
              style={[styles.cell, styles.dayCell]}
            >
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
              <View
                style={[
                  styles.mark,
                  {
                    backgroundColor: dot ?? 'transparent',
                    borderRadius: radius.pill,
                  },
                ]}
              />
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
});
