import React, { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@/shared/assets';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';

export interface CardHeaderProps {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Status pill or actions on the right. */
  right?: ReactNode;
}

/** Icon tile, title and one-line description at the top of a File Management card. */
export function CardHeader({ icon, title, subtitle, right }: CardHeaderProps) {
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          padding: spacing.lg,
          gap: spacing.md,
          borderBottomColor: colors.divider,
        },
      ]}
    >
      <View
        style={[
          styles.tile,
          { backgroundColor: colors.primarySoft, borderRadius: radius.lg },
        ]}
      >
        <Icon name={icon} size={22} color={colors.primaryText} />
      </View>
      <View style={styles.text}>
        <Text
          accessibilityRole="header"
          style={[typography.title, { color: colors.textPrimary }]}
        >
          {title}
        </Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {subtitle}
        </Text>
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tile: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, minWidth: 0 },
});
