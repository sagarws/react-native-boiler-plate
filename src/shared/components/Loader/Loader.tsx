import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';

export interface LoaderProps {
  isVisible?: boolean;
  size?: 'small' | 'large';
  /** Dims and blocks the screen behind it. */
  overlay?: boolean;
}

/** Full-bleed activity indicator used while a screen is busy. */
export function Loader({ isVisible = false, size = 'large', overlay = true }: LoaderProps) {
  const { colors } = useTheme();

  if (!isVisible) return null;

  return (
    <View
      accessibilityRole="progressbar"
      style={[
        styles.container,
        overlay && [StyleSheet.absoluteFill, { backgroundColor: colors.scrim }],
      ]}>
      <ActivityIndicator size={size} color={overlay ? colors.surface : colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
