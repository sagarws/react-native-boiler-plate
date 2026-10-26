import React, { type PropsWithChildren } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export type CardProps = PropsWithChildren<{
  /** `flat` drops the padding, for cards made of full-width rows. */
  flat?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

/** Surface container: themed background, hairline border, rounded corners. */
export function Card({ children, flat = false, style, testID }: CardProps) {
  const { colors, radius, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.xl,
          padding: flat ? 0 : spacing.lg,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
