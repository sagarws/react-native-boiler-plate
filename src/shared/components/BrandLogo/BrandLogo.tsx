import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Icon } from '../Icon';

export type BrandLogoVariant = 'mark' | 'lockup' | 'lockupLight';

export interface BrandLogoProps {
  size?: number;
  variant?: BrandLogoVariant;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app mark — a brand-coloured tile with the scan-text glyph, drawn from
 * theme tokens so it follows the selected colour preset — optionally with the
 * app name beside it.
 */
export function BrandLogo({
  size = 40,
  variant = 'lockup',
  style,
}: BrandLogoProps) {
  const { t } = useTranslation();
  const { colors, radius, spacing, typography } = useTheme();
  const nameColor =
    variant === 'lockupLight' ? colors.primaryForeground : colors.textPrimary;

  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="image"
      accessibilityLabel={t('common.appName')}
    >
      <View
        style={[
          styles.tile,
          {
            width: size,
            height: size,
            borderRadius: Math.min(radius.lg, size / 3),
            backgroundColor:
              variant === 'lockupLight'
                ? colors.primaryForeground
                : colors.primary,
          },
        ]}
      >
        <Icon
          name="scanText"
          size={size * 0.56}
          color={
            variant === 'lockupLight'
              ? colors.primary
              : colors.primaryForeground
          }
        />
      </View>
      {variant !== 'mark' ? (
        <Text
          style={[typography.h2, { color: nameColor, marginLeft: spacing.sm }]}
        >
          {t('common.appName')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: { alignItems: 'center', justifyContent: 'center' },
});
