import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, type ColorPalette } from '@/theme';
import type { CallSummary } from '../types';
import { statusClass, type StatusClass } from '../utils/filters';

export function methodColor(method: string, colors: ColorPalette): string {
  switch (method) {
    case 'GET':
      return colors.primaryText;
    case 'POST':
      return colors.success;
    case 'PUT':
    case 'PATCH':
      return colors.warning;
    case 'DELETE':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

export function statusColor(cls: StatusClass, colors: ColorPalette): string {
  switch (cls) {
    case 'success':
      return colors.success;
    case 'redirect':
    case 'info':
      return colors.primaryText;
    case 'clientError':
      return colors.warning;
    case 'serverError':
    case 'failed':
      return colors.error;
    default:
      return colors.textSecondary;
  }
}

/** Small, fixed-width HTTP method label. The text carries the meaning. */
export function MethodBadge({ method }: { method: string }) {
  const { colors, typography, radius, spacing } = useTheme();
  const color = methodColor(method, colors);
  return (
    <View
      style={[
        styles.badge,
        {
          borderColor: color,
          borderRadius: radius.sm,
          paddingHorizontal: spacing.xs,
        },
      ]}
    >
      <Text
        style={[typography.overline, styles.center, { color }]}
        numberOfLines={1}
      >
        {method.slice(0, 7)}
      </Text>
    </View>
  );
}

/** Status code (or Pending / Failed) in its status colour. */
export function StatusText({
  call,
}: {
  call: Pick<CallSummary, 'status' | 'error' | 'pending'>;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const cls = statusClass(call);
  const label =
    cls === 'pending'
      ? t('network.status.pending')
      : cls === 'failed'
      ? t('network.status.failed')
      : call.status === null
      ? '—'
      : String(call.status);
  return (
    <Text
      style={[typography.label, { color: statusColor(cls, colors) }]}
      numberOfLines={1}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 58,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { textAlign: 'center' },
});
