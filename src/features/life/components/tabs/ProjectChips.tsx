import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { categoryColor, useTheme } from '@/theme';
import type { Project } from '../../types';

/** "All projects" + one chip per project (filters in Calendar / History / Insights). */
export function ProjectChips({
  projects,
  value,
  onChange,
  testID,
}: {
  projects: Project[];
  value: string | null;
  onChange: (id: string | null) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const chip = (id: string | null, label: string, color?: string) => {
    const selected = value === id;
    return (
      <Pressable
        key={id ?? 'all'}
        testID={`${testID}-${id ?? 'all'}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onChange(id)}
        style={[
          styles.chip,
          {
            borderRadius: radius.pill,
            paddingHorizontal: spacing.md,
            borderColor: color ?? colors.border,
            backgroundColor: selected ? colors.primary : colors.surface,
          },
        ]}
      >
        <Text
          style={[
            typography.label,
            { color: selected ? colors.primaryForeground : colors.textPrimary },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: spacing.sm }}
    >
      {chip(null, t('life.allProjects'))}
      {projects.map(p => chip(p.id, p.name, categoryColor(p.color)))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 36, justifyContent: 'center', borderWidth: 1 },
});
