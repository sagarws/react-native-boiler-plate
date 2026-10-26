import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Slider } from '@/shared/components';
import { useTheme } from '@/theme';

export interface SettingSwitchProps {
  value: boolean;
  onChange: (next: boolean) => void;
  label: string;
  testID?: string;
  disabled?: boolean;
}

/** A theme-coloured switch for a ListRow accessory. */
export function SettingSwitch({
  value,
  onChange,
  label,
  testID,
  disabled,
}: SettingSwitchProps) {
  const { colors } = useTheme();
  return (
    <Switch
      testID={testID}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      accessibilityLabel={label}
      trackColor={{ false: colors.disabled, true: colors.primary }}
      thumbColor={colors.surface}
    />
  );
}

export interface SliderRowProps {
  label: string;
  valueText: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  testID?: string;
  /** Divider above (every row but the first in a card). */
  divider?: boolean;
}

/** Label, current value and a stepped slider, as one settings row. */
export function SliderRow({
  label,
  valueText,
  divider = true,
  ...slider
}: SliderRowProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      style={[
        styles.row,
        { padding: spacing.lg, gap: spacing.sm },
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.divider,
        },
      ]}
    >
      <View style={styles.label}>
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {label}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {valueText}
        </Text>
      </View>
      <Slider
        {...slider}
        accessibilityLabel={label}
        accessibilityValueText={valueText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {},
  label: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
