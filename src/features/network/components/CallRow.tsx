import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatTimestamp } from '@/shared/utils';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import type { CallSummary } from '../types';
import { formatDurationMs } from '../utils/filters';
import { MethodBadge, StatusText } from './Badges';

export interface CallRowProps {
  call: CallSummary;
  selecting: boolean;
  selected: boolean;
  onPress: (call: CallSummary) => void;
  onLongPress: (call: CallSummary) => void;
}

/** One captured call: method, endpoint, status, duration and time. */
export const CallRow = memo(function CallRowView({
  call,
  selecting,
  selected,
  onPress,
  onLongPress,
}: CallRowProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing, radius } = useTheme();
  const facts = [
    call.host,
    formatDurationMs(call.durationMs),
    formatTimestamp(Date.parse(call.startedAt)),
  ].filter(Boolean);
  const status = call.pending
    ? t('network.status.pending')
    : call.error
    ? t('network.status.failed')
    : call.status ?? '—';
  return (
    <Pressable
      onPress={() => onPress(call)}
      onLongPress={() => onLongPress(call)}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${call.method} ${
        call.endpoint
      }, ${status}. ${facts.join(', ')}`}
      accessibilityHint={selecting ? undefined : t('network.calls.rowHint')}
      style={({ pressed }) => [
        styles.row,
        {
          gap: spacing.md,
          padding: spacing.md,
          borderRadius: radius.lg,
          backgroundColor: selected ? colors.primarySoft : colors.card,
          borderColor: selected ? colors.primary : colors.border,
        },
        pressed && { opacity: 0.85 },
      ]}
      testID={`net-call-${call.id}`}
    >
      {selecting ? (
        <Icon
          name={selected ? 'circleCheck' : 'square'}
          size={20}
          color={selected ? colors.primaryText : colors.textSecondary}
        />
      ) : null}
      <MethodBadge method={call.method} />
      <View style={[styles.flex, { gap: spacing.xs }]}>
        <Text
          style={[typography.label, { color: colors.textPrimary }]}
          numberOfLines={2}
        >
          {call.endpoint}
        </Text>
        <Text
          style={[typography.caption, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {facts.join(' · ')}
        </Text>
      </View>
      <StatusText call={call} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  flex: { flex: 1 },
});
