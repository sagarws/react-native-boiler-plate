import React from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { fontSize, hp, useTheme, wp } from '@/theme';

export interface SettingsIconButtonProps {
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Small gear that opens the developer endpoint sheet. */
export function SettingsIconButton({
  onPress,
  accessibilityLabel,
  style,
}: SettingsIconButtonProps) {
  const { colors, radius } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={12}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: colors.surface,
          borderColor: colors.primary,
          borderRadius: radius.pill,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}>
      <Text style={[styles.glyph, { color: colors.primary }]}>⚙</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: wp(1),
    minWidth: hp(32),
    minHeight: hp(32),
    paddingHorizontal: wp(4),
  },
  glyph: { fontSize: fontSize(16) },
});
