import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/shared/components';
import { useTheme } from '@/theme';
import { codeText } from './codeText';

export interface KeyValueListProps {
  entries: readonly (readonly [string, string])[];
  emptyTitle: string;
  emptyMessage?: string;
  /** Monospace values (headers); default for overview facts is the body face. */
  code?: boolean;
  testID?: string;
}

/** Label / value rows (headers, overview facts); values are selectable. */
export function KeyValueList({
  entries,
  emptyTitle,
  emptyMessage,
  code = false,
  testID,
}: KeyValueListProps) {
  const { colors, typography, spacing, radius } = useTheme();
  if (!entries.length) {
    return (
      <EmptyState
        icon="listChecks"
        title={emptyTitle}
        message={emptyMessage}
        compact
      />
    );
  }
  return (
    <View
      style={[
        styles.box,
        {
          borderColor: colors.border,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
        },
      ]}
      testID={testID}
    >
      {entries.map(([key, value], i) => (
        <View
          key={`${key}-${i}`}
          style={[
            { padding: spacing.md, gap: spacing.xs },
            i > 0 && {
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.divider,
            },
          ]}
        >
          <Text
            style={[typography.caption, { color: colors.textSecondary }]}
            selectable
          >
            {key}
          </Text>
          <Text
            style={[
              code ? codeText(typography) : typography.body,
              { color: colors.textPrimary },
            ]}
            selectable
          >
            {value}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
