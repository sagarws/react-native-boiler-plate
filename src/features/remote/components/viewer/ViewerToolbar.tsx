import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';

export interface ToolButtonProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  badge?: string;
  testID?: string;
}

export function ToolButton({
  icon,
  label,
  onPress,
  active,
  badge,
  testID,
}: ToolButtonProps) {
  const { colors, typography, spacing, radius } = useTheme();
  const fg = active ? colors.primaryForeground : colors.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label} ${badge}` : label}
      accessibilityState={
        active === undefined ? undefined : { selected: active }
      }
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.tool,
        {
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          borderRadius: radius.md,
          gap: 2,
          backgroundColor: active
            ? colors.primary
            : pressed
            ? colors.overlay
            : 'transparent',
        },
      ]}
    >
      <Icon name={icon} size={20} color={fg} />
      <Text style={[typography.caption, { color: fg }]} numberOfLines={1}>
        {badge ? `${label} ${badge}` : label}
      </Text>
    </Pressable>
  );
}

export interface ViewerToolbarProps {
  title: string;
  status: string;
  statusTone: 'ok' | 'warn';
  onClose: () => void;
  children: React.ReactNode;
}

/** The strip over the top of the remote screen: who, how, and the tools. */
export function ViewerToolbar({
  title,
  status,
  statusTone,
  onClose,
  children,
}: ViewerToolbarProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.overlay,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
          gap: spacing.xs,
        },
      ]}
    >
      <View style={[styles.row, { gap: spacing.sm }]}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('remote.viewer.disconnect')}
          hitSlop={10}
          testID="remote-viewer-close"
        >
          <Icon name="circleX" size={26} color={colors.onPrimary} />
        </Pressable>
        <View style={styles.flex}>
          <Text
            style={[typography.label, { color: colors.onPrimary }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            style={[
              typography.caption,
              {
                color:
                  statusTone === 'warn' ? colors.warning : colors.onPrimary,
              },
              statusTone === 'warn' ? null : styles.dim,
            ]}
            // A warning is an instruction to act on (e.g. a permission on the
            // other device): show it whole, not cut to one line.
            numberOfLines={statusTone === 'warn' ? 4 : 1}
            accessibilityLiveRegion="polite"
          >
            {status}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: spacing.xs }}
        keyboardShouldPersistTaps="always"
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.8 },
  bar: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  tool: { alignItems: 'center', justifyContent: 'center', minWidth: 56 },
});
