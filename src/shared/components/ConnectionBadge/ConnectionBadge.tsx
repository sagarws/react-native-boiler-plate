import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { useSocketStatus, type SocketStatus } from '@/services/realtime';

export interface ConnectionBadgeProps {
  /** Hide the text and show only the dot. */
  compact?: boolean;
}

const COLORS: Record<SocketStatus, string> = {
  connected: '#1E9F5C',
  connecting: '#F59E0B',
  disconnected: '#DC2626',
};

// Live indicator for the realtime singleton's connection state. Renders a
// coloured dot + (optional) status label. Subscribes via useSocketStatus,
// so the badge updates the instant the socket connects, drops, or rebinds
// after an endpoint override.
export function ConnectionBadge({ compact = false }: ConnectionBadgeProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography, radius } = useTheme();
  const status = useSocketStatus();
  const dotColor = COLORS[status];

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={t(`connection.${status}`) ?? status}
      style={[
        styles.row,
        {
          backgroundColor: colors.muted,
          borderRadius: radius.pill,
          paddingHorizontal: compact ? spacing.xs : spacing.sm,
          paddingVertical: 2,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      {compact ? null : (
        <Text
          style={[
            typography.caption,
            {
              color: colors.mutedForeground,
              marginLeft: spacing.xs,
              fontWeight: '600',
            },
          ]}
        >
          {t(`connection.${status}`)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
