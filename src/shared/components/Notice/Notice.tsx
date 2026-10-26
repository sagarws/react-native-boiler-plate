import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IconName } from '@/shared/assets';
import { useTheme, type ColorPalette } from '@/theme';
import { Icon } from '../Icon';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

export interface NoticeProps {
  message: string;
  title?: string;
  tone?: NoticeTone;
  action?: { label: string; onPress: () => void };
  onDismiss?: () => void;
  testID?: string;
}

function toneStyle(
  tone: NoticeTone,
  colors: ColorPalette,
): { color: string; icon: IconName } {
  switch (tone) {
    case 'success':
      return { color: colors.success, icon: 'circleCheck' };
    case 'warning':
      return { color: colors.warning, icon: 'triangleAlert' };
    case 'error':
      return { color: colors.error, icon: 'triangleAlert' };
    case 'info':
    default:
      return { color: colors.primaryText, icon: 'info' };
  }
}

/** Inline banner for permission prompts, outcomes and recoverable errors. */
export function Notice({
  message,
  title,
  tone = 'info',
  action,
  onDismiss,
  testID,
}: NoticeProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const { color, icon } = toneStyle(tone, colors);

  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[
        styles.box,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderLeftColor: color,
          borderRadius: radius.lg,
          padding: spacing.md,
          gap: spacing.md,
        },
      ]}
    >
      <Icon name={icon} size={20} color={color} />
      <View style={styles.body}>
        {title ? (
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {title}
          </Text>
        ) : null}
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {message}
        </Text>
        {action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={action.onPress}
            hitSlop={8}
            style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
          >
            <Text style={[typography.label, { color: colors.primaryText }]}>
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.dismiss')}
          hitSlop={10}
          onPress={onDismiss}
        >
          <Icon name="x" size={18} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  body: { flex: 1 },
});
