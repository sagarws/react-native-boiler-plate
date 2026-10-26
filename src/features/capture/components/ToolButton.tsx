import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { IconName } from '@/shared/assets';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';

export interface ToolButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  testID?: string;
}

/** Icon-over-label action for the editor toolbar; 56dp tall touch target. */
export function ToolButton({
  icon,
  label,
  onPress,
  disabled = false,
  active = false,
  testID,
}: ToolButtonProps) {
  const { colors, typography, radius } = useTheme();
  const tint = disabled
    ? colors.disabledForeground
    : active
    ? colors.primaryForeground
    : colors.primaryText;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          borderRadius: radius.lg,
          backgroundColor: active
            ? colors.primary
            : pressed
            ? colors.secondary
            : colors.primarySoft,
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <Icon name={icon} size={20} color={tint} />
      <Text
        numberOfLines={1}
        style={[typography.caption, { color: tint, marginTop: 2 }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
