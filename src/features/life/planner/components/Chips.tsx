import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export interface ChipOption {
  value: string;
  label: string;
  /** Dot colour (statuses, categories). */
  color?: string;
}

/** A wrapping row of single-choice chips with optional colour dots. */
export function Chips({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: {
  options: readonly ChipOption[];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  testID: string;
}) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View
      style={[styles.wrap, { gap: spacing.xs }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            style={[
              styles.chip,
              {
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                borderRadius: radius.pill,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primarySoft : colors.surface,
              },
            ]}
            testID={`${testID}-${o.value}`}
          >
            {o.color ? (
              <View style={[styles.dot, { backgroundColor: o.color }]} />
            ) : null}
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 38,
    borderWidth: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
