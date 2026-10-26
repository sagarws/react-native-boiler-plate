import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
import { icons, type IconName } from '@/shared/assets';
import { useTheme } from '@/theme';

export interface IconProps {
  name: IconName;
  size?: number;
  /** Defaults to the theme's primary text colour. */
  color?: string;
  style?: StyleProp<ImageStyle>;
}

/** A theme-tinted interface icon. Decorative: label the control that holds it. */
export function Icon({ name, size = 20, color, style }: IconProps) {
  const { colors } = useTheme();
  return (
    <Image
      source={icons[name]}
      resizeMode="contain"
      accessibilityIgnoresInvertColors
      accessible={false}
      style={[
        { width: size, height: size, tintColor: color ?? colors.textPrimary },
        style,
      ]}
    />
  );
}
