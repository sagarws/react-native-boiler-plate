import React from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  Text,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '@/theme';
import type { ColorPalette } from '@/theme';
import { Icon } from '../Icon';
import { buttonStyles } from './Button.styles';
import type { ButtonProps, ButtonVariant } from './Button.types';

interface Tone {
  background: string;
  pressed: string;
  border: string;
  text: string;
}

function paletteFor(variant: ButtonVariant, colors: ColorPalette): Tone {
  switch (variant) {
    case 'secondary':
      return {
        background: 'transparent',
        pressed: colors.primarySoft,
        border: colors.primary,
        text: colors.primaryText,
      };
    case 'soft':
      return {
        background: colors.primarySoft,
        pressed: colors.secondary,
        border: colors.primarySoft,
        text: colors.primaryText,
      };
    case 'ghost':
      return {
        background: 'transparent',
        pressed: colors.surfaceMuted,
        border: 'transparent',
        text: colors.primaryText,
      };
    case 'danger':
      return {
        background: colors.error,
        pressed: colors.error,
        border: colors.error,
        text: colors.errorForeground,
      };
    case 'primary':
    default:
      return {
        background: colors.primary,
        pressed: colors.primaryPressed,
        border: colors.primary,
        text: colors.primaryForeground,
      };
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconName,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { colors, typography, radius } = useTheme();
  const tone = paletteFor(variant, colors);
  const labelStyle = size === 'sm' ? typography.label : typography.button;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      hitSlop={size === 'sm' ? 4 : undefined}
      testID={testID}
      style={({ pressed }) => {
        const dynamic: ViewStyle = {
          backgroundColor: isDisabled
            ? variant === 'ghost' || variant === 'secondary'
              ? 'transparent'
              : colors.disabled
            : pressed
            ? tone.pressed
            : tone.background,
          borderColor: isDisabled ? colors.disabled : tone.border,
          borderRadius: size === 'lg' ? radius.xl : radius.lg,
        };
        return [buttonStyles.base, buttonStyles[size], dynamic, style];
      }}
    >
      {loading ? (
        <ActivityIndicator color={tone.text} size="small" />
      ) : (
        <>
          {iconName ? (
            <Icon
              name={iconName}
              size={18}
              color={isDisabled ? colors.disabledForeground : tone.text}
            />
          ) : icon ? (
            <Image
              source={icon}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={[buttonStyles.icon, { tintColor: tone.text }]}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              labelStyle,
              { color: isDisabled ? colors.disabledForeground : tone.text },
            ]}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
