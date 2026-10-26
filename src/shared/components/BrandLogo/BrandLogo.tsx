import React from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { images } from '@/shared/assets';
import { useTheme } from '@/theme';

export type BrandLogoVariant = 'mark' | 'lockup' | 'lockupLight';

export interface BrandLogoProps {
  size?: number;
  variant?: BrandLogoVariant;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app logo (the round emblem, also used for the launcher icon — see
 * scripts/icon/generate-icons-from-logo.js), optionally with the app name
 * beside it. The emblem keeps its own colours; only the name follows the
 * theme.
 */
export function BrandLogo({
  size = 40,
  variant = 'lockup',
  style,
}: BrandLogoProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography } = useTheme();
  const nameColor =
    variant === 'lockupLight' ? colors.primaryForeground : colors.textPrimary;

  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="image"
      accessibilityLabel={t('common.appName')}
    >
      <Image
        source={images.app_logo}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size }}
      />
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
});
