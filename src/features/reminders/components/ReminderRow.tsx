import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon, ToggleSwitch } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';
import {
  CATEGORY_COLOR,
  CATEGORY_ICON,
  HIGHLIGHT,
  type Reminder,
} from '../types';
import { formatWhen } from '../utils/format';

/** One reminder: category, title, when and repeat, with an on / off switch. */
export function ReminderRow({
  reminder: r,
  at,
  onPress,
  onToggle,
}: {
  reminder: Reminder;
  /** The occurrence to show (next one, or when it rang). */
  at: number | null;
  onPress: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const tint = categoryColor(CATEGORY_COLOR[r.category]);
  const highlight = HIGHLIGHT.includes(r.category);
  const kind =
    r.category === 'custom' && r.customLabel
      ? r.customLabel
      : t(`reminders.category_${r.category}`);
  const when = at !== null ? formatWhen(at) : '';
  const repeat = r.repeat !== 'never' ? t(`reminders.repeat_${r.repeat}`) : '';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[r.title, kind, when, repeat]
        .filter(Boolean)
        .join(', ')}
      testID={`reminder-${r.id}`}
      style={({ pressed }) => [
        styles.row,
        {
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: pressed ? colors.surfaceMuted : colors.card,
          borderColor: highlight ? tint : colors.border,
          borderLeftColor: tint,
        },
        !r.enabled && styles.off,
      ]}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: tint, borderRadius: radius.md },
        ]}
      >
        <Icon
          name={CATEGORY_ICON[r.category]}
          size={20}
          color={colors.primaryForeground}
        />
      </View>
      <View style={styles.flex}>
        <Text
          style={[typography.label, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {r.title}
        </Text>
        <Text
          style={[typography.caption, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {[when, repeat, kind].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {onToggle ? (
        <ToggleSwitch
          isOn={r.enabled}
          onToggle={onToggle}
          accessibilityLabel={t('reminders.enabledFor', { title: r.title })}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  off: { opacity: 0.6 },
  icon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: { flex: 1, minWidth: 0 },
});
