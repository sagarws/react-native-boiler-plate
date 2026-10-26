import React, { type PropsWithChildren } from 'react';
import { Text, View } from 'react-native';
import { Card } from '@/shared/components';
import { useTheme } from '@/theme';

export type SettingsSectionProps = PropsWithChildren<{
  title: string;
  /** Explanatory text under the card. */
  footer?: string;
  /** Pad the card, for content that is not a list of rows. */
  padded?: boolean;
  testID?: string;
}>;

/** A titled group of settings rows. */
export function SettingsSection({
  title,
  footer,
  padded = false,
  children,
  testID,
}: SettingsSectionProps) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View testID={testID} style={{ gap: spacing.sm }}>
      <Text
        accessibilityRole="header"
        style={[
          typography.overline,
          { color: colors.textSecondary, marginLeft: spacing.xs },
        ]}
      >
        {title}
      </Text>
      <Card flat={!padded}>{children}</Card>
      {footer ? (
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginHorizontal: spacing.xs },
          ]}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}
