import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@/shared/assets';
import { Icon } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';

/** Thin progress bar; [percent] is clamped to 0–100. */
export function ProgressBar({
  percent,
  color,
  height = 6,
  testID,
}: {
  percent: number;
  color?: string;
  height?: number;
  testID?: string;
}) {
  const { colors, radius } = useTheme();
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <View
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      style={[
        styles.track,
        {
          height,
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.pill,
        },
      ]}
    >
      <View
        style={{
          width: `${clamped}%`,
          height,
          backgroundColor: color ?? colors.primary,
          borderRadius: radius.pill,
        }}
      />
    </View>
  );
}

/** Project / task picture, or its icon on its colour. */
export function Avatar({
  icon,
  imageUri,
  color,
  size = 44,
}: {
  icon: string;
  imageUri?: string;
  color: string;
  size?: number;
}) {
  const { colors, radius } = useTheme();
  const box = { width: size, height: size, borderRadius: radius.lg };
  if (imageUri) {
    return (
      <Image
        source={{ uri: imageUri }}
        style={box}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={[box, styles.center, { backgroundColor: categoryColor(color) }]}
    >
      <Icon
        name={icon as IconName}
        size={Math.round(size * 0.5)}
        color={colors.primaryForeground}
      />
    </View>
  );
}

/** A dashboard number with its label. */
export function StatCard({
  label,
  value,
  tone,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  tone?: 'warning' | 'success';
  onPress?: () => void;
  testID?: string;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  const valueColor =
    tone === 'warning'
      ? colors.warning
      : tone === 'success'
      ? colors.success
      : colors.textPrimary;
  return (
    <Pressable
      testID={testID}
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
      style={[
        styles.stat,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: radius.lg,
          padding: spacing.md,
        },
      ]}
    >
      <Text style={[typography.h2, { color: valueColor }]} numberOfLines={1}>
        {value}
      </Text>
      <Text
        style={[typography.caption, { color: colors.textSecondary }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Small coloured pill (status / badge). */
export function Badge({ label, color }: { label: string; color: string }) {
  const { typography, radius, spacing, colors } = useTheme();
  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: color,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.sm,
        },
      ]}
    >
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
  track: { width: '100%', overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  stat: {
    flexGrow: 1,
    flexBasis: '45%',
    borderWidth: 1,
    minHeight: 72,
    justifyContent: 'center',
  },
  badge: { borderWidth: 1, alignSelf: 'flex-start' },
});
