import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export interface SettingSwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

/** A labelled switch row with an optional hint, divider above. */
export function SettingSwitchRow({
  label,
  hint,
  value,
  onChange,
  disabled,
  testID,
}: SettingSwitchRowProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          gap: spacing.md,
          borderTopColor: colors.divider,
        },
      ]}
    >
      <View style={styles.text}>
        <Text
          style={[
            typography.label,
            { color: disabled ? colors.textSecondary : colors.textPrimary },
          ]}
        >
          {label}
        </Text>
        {hint ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.disabled, true: colors.primary }}
        thumbColor={colors.surface}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
});
