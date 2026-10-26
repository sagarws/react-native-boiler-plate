import React from 'react';
import { ActivityIndicator, Image, Pressable, Text, type ViewStyle } from 'react-native';
import { hp, useTheme } from '@/theme';
import { buttonStyles } from './Button.styles';
import type { ButtonProps, ButtonVariant } from './Button.types';
import type { ColorPalette } from '@/theme';

/** Filled for the primary path, outlined for the secondary one. */
function paletteFor(variant: ButtonVariant, colors: ColorPalette) {
  switch (variant) {
    case 'secondary':
      return { background: 'transparent', border: colors.primary, text: colors.primary };
    case 'danger':
      return { background: colors.danger, border: colors.danger, text: colors.onPrimary };
    case 'primary':
    default:
      return { background: colors.primary, border: colors.primary, text: colors.onPrimary };
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
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const { colors, typography } = useTheme();
  const tone = paletteFor(variant, colors);
  const labelStyle = size === 'sm' ? typography.body : typography.button;
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      style={({ pressed }) => {
        const dynamic: ViewStyle = {
          backgroundColor: tone.background,
          borderColor: tone.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.8 : 1,
        };
        return [buttonStyles.base, dynamic, style];
      }}>
      {loading ? (
        <ActivityIndicator color={tone.text} size={hp(14)} />
      ) : (
        <>
          {icon ? (
            <Image
              source={icon}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={buttonStyles.icon}
            />
          ) : null}
          <Text numberOfLines={1} style={[labelStyle, { color: tone.text }]}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}
