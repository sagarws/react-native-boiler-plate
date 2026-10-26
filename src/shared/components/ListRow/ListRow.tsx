import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IconName } from '@/shared/assets';
import { useTheme } from '@/theme';
import { Icon } from '../Icon';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Accessory on the right: a switch, a value, a pill. */
  right?: ReactNode;
  /** Shows a chevron; implied for pressable rows without a `right`. */
  chevron?: boolean;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** Draws the divider above this row (every row but the first in a card). */
  divider?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** One settings-style row: icon well, title + subtitle, accessory. */
export function ListRow({
  title,
  subtitle,
  icon,
  right,
  chevron,
  onPress,
  destructive = false,
  disabled = false,
  divider = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ListRowProps) {
  const { colors, typography, radius, spacing } = useTheme();
  const tint = destructive ? colors.error : colors.primaryText;
  const showChevron = chevron ?? (onPress != null && right == null);

  const body = (
    <>
      {icon ? (
        <View
          style={[
            styles.iconWell,
            {
              backgroundColor: destructive
                ? colors.surfaceMuted
                : colors.primarySoft,
              borderRadius: radius.md,
            },
          ]}
        >
          <Icon name={icon} size={18} color={tint} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text
          style={[
            typography.label,
            { color: destructive ? colors.error : colors.textPrimary },
          ]}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[
              typography.caption,
              { color: colors.textSecondary, marginTop: 2 },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ marginLeft: spacing.sm }}>{right}</View> : null}
      {showChevron ? (
        <Icon
          name="chevronRight"
          size={18}
          color={colors.placeholder}
          style={{ marginLeft: spacing.xs }}
        />
      ) : null}
    </>
  );

  const rowStyle = [
    styles.row,
    {
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
      opacity: disabled ? 0.5 : 1,
    },
    divider && {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
  ];

  if (!onPress) {
    return (
      <View
        style={rowStyle}
        testID={testID}
        accessible={right == null}
        accessibilityLabel={accessibilityLabel}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      android_ripple={{ color: colors.primarySoft }}
      style={({ pressed }) => [
        rowStyle,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingVertical: 10,
  },
  iconWell: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
});
