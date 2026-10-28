import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTheme } from '@/theme';

/** Label + input used across the Manage Life forms. */
export function FormField({
  label,
  hint,
  multiline,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string }) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.placeholder}
        multiline={multiline}
        style={[
          typography.body,
          styles.input,
          multiline && styles.multi,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          },
          style,
        ]}
        {...input}
      />
      {hint ? (
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const { colors, typography, spacing } = useTheme();
  return (
    <Text
      style={[
        typography.title,
        { color: colors.textPrimary, marginTop: spacing.sm },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, minHeight: 48 },
  multi: { minHeight: 80, textAlignVertical: 'top', paddingTop: 12 },
});
