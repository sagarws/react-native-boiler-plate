import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@/shared/assets';
import { ListRow, Slider, ToggleSwitch } from '@/shared/components';
import { useTheme } from '@/theme';

/** A settings row with a switch on the right. */
export function SwitchRow({
  icon,
  title,
  subtitle,
  value,
  onChange,
  divider,
  disabled,
  testID,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  divider?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <ListRow
      icon={icon}
      title={title}
      subtitle={subtitle}
      divider={divider}
      testID={testID}
      right={
        <ToggleSwitch
          isOn={value}
          onToggle={onChange}
          disabled={disabled}
          accessibilityLabel={title}
        />
      }
    />
  );
}

/** A wrapping row of selectable chips (single choice). */
export function OptionChips<T extends string | number>({
  label,
  options,
  value,
  onChange,
  testID,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  testID?: string;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
      <View
        style={[styles.wrap, { gap: spacing.sm }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map(o => {
          const selected = o.value === value;
          return (
            <Pressable
              key={String(o.value)}
              testID={testID ? `${testID}-${o.value}` : undefined}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={o.label}
              style={[
                styles.chip,
                {
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.pill,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.surface,
                },
              ]}
            >
              <Text
                style={[
                  typography.caption,
                  {
                    color: selected
                      ? colors.primaryForeground
                      : colors.textPrimary,
                  },
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Label + value text above a stepped slider. */
export function LabeledSlider({
  label,
  valueText,
  value,
  min,
  max,
  step,
  onChange,
  testID,
}: {
  label: string;
  valueText: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  testID?: string;
}) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={styles.between}>
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {label}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {valueText}
        </Text>
      </View>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={onChange}
        accessibilityLabel={label}
        accessibilityValueText={valueText}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1 },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
