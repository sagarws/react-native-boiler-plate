import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { Button } from '../Button';
import { Icon } from '../Icon';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
  /** Smaller illustration, for empty states inside a card. */
  compact?: boolean;
  testID?: string;
}

/** Illustrated "nothing here yet" / error state with an optional way forward. */
export function EmptyState({
  icon,
  title,
  message,
  action,
  compact = false,
  testID,
}: EmptyStateProps) {
  const { colors, typography, spacing } = useTheme();
  const well = compact ? 56 : 88;

  return (
    <View
      testID={testID}
      style={[styles.container, { padding: compact ? spacing.lg : spacing.xl }]}
    >
      <View
        style={[
          styles.well,
          {
            width: well,
            height: well,
            borderRadius: well / 2,
            backgroundColor: colors.primarySoft,
          },
        ]}
      >
        <Icon name={icon} size={well * 0.42} color={colors.primaryText} />
      </View>
      <Text
        style={[
          compact ? typography.title : typography.h2,
          styles.center,
          { color: colors.textPrimary, marginTop: spacing.md },
        ]}
      >
        {title}
      </Text>
      {message ? (
        <Text
          style={[
            typography.body,
            styles.center,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {message}
        </Text>
      ) : null}
      {action ? (
        <Button
          label={action.label}
          onPress={action.onPress}
          variant="soft"
          size="sm"
          style={{
            marginTop: spacing.lg,
            alignSelf: 'center',
            paddingHorizontal: spacing.xl,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  well: { alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
});
