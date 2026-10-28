import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';

export interface TabBarProps<T extends string> {
  value: T;
  onChange: (tab: T) => void;
  tabs: readonly { value: T; label: string }[];
  accessibilityLabel: string;
  /** testID prefix; each tab gets `${testID}-${value}`. */
  testID: string;
  /** Scroll horizontally (many tabs) instead of sharing the width equally. */
  scrollable?: boolean;
}

/** Segmented tab switcher (Settings sections, Manage Life sections). */
export function TabBar<T extends string>({
  value,
  onChange,
  tabs,
  accessibilityLabel,
  testID,
  scrollable = false,
}: TabBarProps<T>) {
  const { colors, typography, radius, spacing } = useTheme();
  const items = tabs.map(tab => {
    const selected = tab.value === value;
    return (
      <Pressable
        key={tab.value}
        testID={`${testID}-${tab.value}`}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={tab.label}
        onPress={() => onChange(tab.value)}
        style={[
          styles.tab,
          scrollable ? { paddingHorizontal: spacing.md } : styles.flex,
          { borderRadius: radius.md },
          selected && { backgroundColor: colors.surface },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            typography.label,
            { color: selected ? colors.primaryText : colors.textSecondary },
          ]}
        >
          {tab.label}
        </Text>
      </Pressable>
    );
  });
  const barStyle = [
    styles.bar,
    {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.lg,
      padding: spacing.xs,
    },
  ];
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{ marginHorizontal: spacing.lg, marginBottom: spacing.sm }}
    >
      {scrollable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={barStyle}
        >
          {items}
        </ScrollView>
      ) : (
        <View style={barStyle}>{items}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row' },
  flex: { flex: 1 },
  tab: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
