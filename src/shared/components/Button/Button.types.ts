import type {
  ImageSourcePropType,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import type { IconName } from '@/shared/assets';

/**
 * `primary` filled brand colour, `secondary` outlined, `soft` tinted fill for
 * toolbars and secondary actions, `ghost` text only, `danger` destructive.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'soft'
  | 'ghost'
  | 'danger';

/** `lg` hero action, `md` full-width action, `sm` compact in-row action. */
export type ButtonSize = 'lg' | 'md' | 'sm';

export type ButtonProps = {
  label: string;
  onPress: PressableProps['onPress'];
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Swaps the label for a spinner and blocks presses. */
  loading?: boolean;
  /** Optional raster glyph rendered to the left of the label. */
  icon?: ImageSourcePropType;
  /** Optional themed icon rendered to the left of the label. */
  iconName?: IconName;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};
