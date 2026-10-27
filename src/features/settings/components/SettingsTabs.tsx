import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export type SettingsTab = 'general' | 'ocr' | 'files';

export interface SettingsTabsProps {
  value: SettingsTab;
  onChange: (tab: SettingsTab) => void;
  tabs: { value: SettingsTab; label: string }[];
  accessibilityLabel: string;
}

/** The General / OCR / File Management switcher at the top of Settings. */
export function SettingsTabs({
  value,
  onChange,
  tabs,
  accessibilityLabel,
}: SettingsTabsProps) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceMuted,
          borderRadius: radius.lg,
          padding: spacing.xs,
          marginHorizontal: spacing.lg,
          marginBottom: spacing.sm,
        },
      ]}
    >
      {tabs.map(tab => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            testID={`settings-tab-${tab.value}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => onChange(tab.value)}
            style={[
              styles.tab,
              { borderRadius: radius.md },
              selected && { backgroundColor: colors.surface },
            ]}
          >
            <Text
              style={[
                typography.label,
                { color: selected ? colors.primaryText : colors.textSecondary },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row' },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
