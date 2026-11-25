import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '@/theme';

export interface KeyChipProps {
  label: string;
  onPress: () => void;
  active?: boolean;
  accessibilityLabel?: string;
  compact?: boolean;
}

/** One key / shortcut button; `active` = a held (sticky) modifier. */
export function KeyChip({
  label,
  onPress,
  active,
  accessibilityLabel,
  compact,
}: KeyChipProps) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={
        active === undefined ? undefined : { selected: active }
      }
      style={({ pressed }) => [
        styles.chip,
        {
          minWidth: compact ? 40 : 52,
          paddingHorizontal: compact ? spacing.sm : spacing.md,
          paddingVertical: compact ? spacing.xs + 2 : spacing.sm,
          borderRadius: radius.md,
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active
            ? colors.primary
            : pressed
            ? colors.surfaceMuted
            : colors.surface,
        },
      ]}
    >
      <Text
        style={[
          typography.label,
          { color: active ? colors.primaryForeground : colors.textPrimary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
