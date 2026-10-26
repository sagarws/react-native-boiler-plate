import React, { forwardRef } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { images } from '@/shared/assets';
import { hp, isIos, useTheme, wp } from '@/theme';
import type { TextFieldProps } from './TextField.types';

/**
 * Bordered text input carried over from the previous app.
 *
 * The label is not drawn — the placeholder carries it visually, as it did
 * before — but it is still passed to the platform as the accessible name so
 * the field never reads as unlabelled.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(
  function TextFieldBase(
    {
      label,
      error,
      rightIcon,
      passwordToggle = false,
      passwordVisible = false,
      onTogglePassword,
      containerStyle,
      testID,
      ...inputProps
    },
    ref,
  ) {
    const { t } = useTranslation();
    const { colors, typography, radius } = useTheme();
    const hasError = Boolean(error);

    return (
      <View style={[styles.wrap, containerStyle]}>
        <View
          style={[
            styles.inputRow,
            {
              backgroundColor: colors.surface,
              borderColor: hasError ? colors.red : colors.inputBorder,
              borderRadius: radius.md,
            },
          ]}
        >
          <TextInput
            ref={ref}
            accessibilityLabel={label}
            placeholderTextColor={colors.grey}
            testID={testID}
            {...inputProps}
            style={[typography.body, styles.input, { color: colors.text }]}
          />
          {rightIcon && !passwordToggle ? (
            <Image
              source={rightIcon}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
              style={[styles.rightIcon, { tintColor: colors.grey }]}
            />
          ) : null}
          {passwordToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t(
                passwordVisible ? 'auth.hidePassword' : 'auth.showPassword',
              )}
              hitSlop={8}
              onPress={onTogglePassword}
            >
              <Image
                source={passwordVisible ? images.icon_eye_off : images.icon_eye}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
                style={[styles.eyeIcon, { tintColor: colors.grey }]}
              />
            </Pressable>
          ) : null}
        </View>
        {hasError ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[typography.caption, styles.error, { color: colors.red }]}
          >
            {error}
          </Text>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  wrap: { width: '100%', marginVertical: hp(6) },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: wp(2),
    paddingHorizontal: wp(8),
  },
  input: { flex: 1, paddingVertical: hp(isIos ? 6 : 4) },
  rightIcon: { height: hp(16), width: hp(16) },
  eyeIcon: { height: hp(18), width: hp(18) },
  error: { marginTop: hp(4) },
});
