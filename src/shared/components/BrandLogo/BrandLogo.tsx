import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export type BrandLogoVariant = 'mark' | 'lockup' | 'lockupLight';

export interface BrandLogoProps {
  size?: number;
  variant?: BrandLogoVariant;
  style?: StyleProp<ViewStyle>;
}

// A token-only placeholder mark: a rounded tile with a play triangle, drawn
// from Views so it stays crisp at any density with no raster asset. Swap the
// whole component for the real logo (an SVG via react-native-svg, or an
// <Image>) once brand assets exist — every screen imports `BrandLogo`, so
// nothing else has to change.
function PlayMark({ size }: { size: number }) {
  const { colors, radius } = useTheme();
  const triangle = size * 0.34;

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: radius.lg,
          backgroundColor: colors.primary,
        },
      ]}>
      <View
        style={{
          width: 0,
          height: 0,
          marginLeft: triangle * 0.25,
          borderTopWidth: triangle * 0.6,
          borderBottomWidth: triangle * 0.6,
          borderLeftWidth: triangle,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: colors.primaryForeground,
        }}
      />
    </View>
  );
}

export function BrandLogo({ size = 44, variant = 'lockup', style }: BrandLogoProps) {
  const { colors, spacing, typography } = useTheme();
  const lockupLight = variant === 'lockupLight';
  const showWordmark = variant !== 'mark';

  // On dark surfaces the first half of the wordmark switches to the sidebar
  // foreground so it stays readable; the accent half always uses `primary`.
  const leadColor = lockupLight ? colors.sidebarForeground : colors.text;
  const accentColor = colors.primary;
  const wordSize = size * 0.62;

  return (
    <View style={[styles.row, style]}>
      <PlayMark size={size} />
      {showWordmark ? (
        <View style={{ marginLeft: spacing.sm }}>
          <View style={styles.row}>
            <Text
              style={[
                typography.h2,
                { color: leadColor, fontSize: wordSize, lineHeight: wordSize * 1.05 },
              ]}>
              Track
            </Text>
            <Text
              style={[
                typography.h2,
                {
                  color: accentColor,
                  fontSize: wordSize,
                  lineHeight: wordSize * 1.05,
                  fontWeight: '700',
                },
              ]}>
              vid
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
