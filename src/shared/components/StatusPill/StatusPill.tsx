import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme, type ColorPalette } from '@/theme';

export type StatusTone =
  | 'success'
  | 'warning'
  | 'error'
  | 'neutral'
  | 'primary';

export interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  testID?: string;
}

function toneColor(tone: StatusTone, colors: ColorPalette): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'error':
      return colors.error;
    case 'primary':
      return colors.primaryText;
    case 'neutral':
    default:
      return colors.textSecondary;
  }
}

/** Small status label with a coloured dot; the text carries the meaning, not the colour. */
export function StatusPill({
  label,
  tone = 'neutral',
  testID,
}: StatusPillProps) {
  const { colors, typography, radius } = useTheme();
  const color = toneColor(tone, colors);

  return (
    <View
      testID={testID}
      style={[
        styles.pill,
        { backgroundColor: colors.surfaceMuted, borderRadius: radius.pill },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text
        style={[typography.caption, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 6,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
