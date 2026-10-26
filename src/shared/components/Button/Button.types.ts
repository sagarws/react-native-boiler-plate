import type { ImageSourcePropType, PressableProps, StyleProp, ViewStyle } from 'react-native';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * `md` is the full-width action size (sign in, sign out); `sm` matches the
 * previous app's narrower in-row buttons, whose labels were a step smaller so
 * three of them fit across a phone.
 */
export type ButtonSize = 'md' | 'sm';

export type ButtonProps = {
  label: string;
  onPress: PressableProps['onPress'];
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks presses. */
  loading?: boolean;
  /** Optional glyph rendered to the left of the label. */
  icon?: ImageSourcePropType;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
