import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IconName } from '@/shared/assets';
import { Button, Icon } from '@/shared/components';
import { CATEGORY_COLORS, categoryColor, useTheme } from '@/theme';
import type { DayKey } from '../types';
import { formatLongDay } from '../utils/format';
import { MonthCalendar } from './MonthCalendar';

/** Icons offered for projects and tasks. */
export const LIFE_ICONS: readonly IconName[] = [
  'layers',
  'bookOpen',
  'gauge',
  'audioLines',
  'languages',
  'palette',
  'sparkles',
  'scrollText',
  'circleCheck',
  'history',
  'bell',
  'lock',
  'share2',
  'monitor',
  'smartphone',
  'download',
  'type',
  'sun',
  'moon',
  'folder',
  'cloud',
  'play',
];

export function ColorPicker({
  value,
  onChange,
  testID,
}: {
  value: string;
  onChange: (c: string) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={[styles.wrap, { gap: spacing.sm }]}
      accessibilityRole="radiogroup"
    >
      {CATEGORY_COLORS.map(key => {
        const selected = key === value;
        return (
          <Pressable
            key={key}
            testID={`${testID}-${key}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`life.color_${key}`)}
            onPress={() => onChange(key)}
            style={[
              styles.swatch,
              {
                backgroundColor: categoryColor(key),
                borderRadius: radius.pill,
              },
              selected && { borderColor: colors.textPrimary },
            ]}
          >
            {selected ? (
              <Icon name="check" size={18} color={colors.primaryForeground} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function IconPicker({
  value,
  color,
  onChange,
  testID,
}: {
  value: string;
  color: string;
  onChange: (icon: string) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      style={[styles.wrap, { gap: spacing.sm }]}
      accessibilityRole="radiogroup"
    >
      {LIFE_ICONS.map(name => {
        const selected = name === value;
        return (
          <Pressable
            key={name}
            testID={`${testID}-${name}`}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`life.icon_${name}`)}
            onPress={() => onChange(name)}
            style={[
              styles.iconCell,
              {
                borderRadius: radius.md,
                backgroundColor: selected
                  ? categoryColor(color)
                  : colors.surfaceMuted,
              },
            ]}
          >
            <Icon
              name={name}
              size={22}
              color={selected ? colors.primaryForeground : colors.textSecondary}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled date button that opens a month calendar. */
export function DateField({
  label,
  value,
  onChange,
  today,
  min,
  allowClear,
  emptyLabel,
  testID,
}: {
  label: string;
  value: DayKey | null;
  onChange: (day: DayKey | null) => void;
  today: DayKey;
  min?: DayKey;
  allowClear?: boolean;
  emptyLabel?: string;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<DayKey>(value ?? today);
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${
          value ? formatLongDay(value) : emptyLabel ?? ''
        }`}
        onPress={() => {
          setMonth(value ?? today);
          setOpen(true);
        }}
        style={[
          styles.field,
          {
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            padding: spacing.md,
          },
        ]}
      >
        <Text
          style={[
            typography.body,
            styles.flex,
            { color: value ? colors.textPrimary : colors.placeholder },
          ]}
        >
          {value ? formatLongDay(value) : emptyLabel ?? t('life.pickDate')}
        </Text>
        <Icon name="history" size={18} color={colors.textSecondary} />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={[
            styles.scrim,
            { backgroundColor: colors.overlay, padding: spacing.lg },
          ]}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                borderRadius: radius.xl,
                padding: spacing.lg,
                gap: spacing.md,
              },
            ]}
          >
            <MonthCalendar
              month={month}
              onMonthChange={setMonth}
              selected={value}
              onSelect={d => {
                onChange(d);
                setOpen(false);
              }}
              today={today}
              min={min}
              testID={`${testID}-calendar`}
            />
            <View style={[styles.row, { gap: spacing.sm }]}>
              {allowClear ? (
                <Button
                  variant="ghost"
                  size="sm"
                  label={t('life.clear')}
                  onPress={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  style={styles.flex}
                />
              ) : null}
              <Button
                size="sm"
                variant="soft"
                label={t('life.cancel')}
                onPress={() => setOpen(false)}
                style={styles.flex}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  swatch: {
    width: 40,
    height: 40,
    borderWidth: 3,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCell: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 48,
  },
  flex: { flex: 1 },
  row: { flexDirection: 'row' },
  scrim: { flex: 1, justifyContent: 'center' },
  sheet: { maxWidth: 420, width: '100%', alignSelf: 'center' },
});
