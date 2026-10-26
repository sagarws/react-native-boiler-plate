import type {
  ImageSourcePropType,
  StyleProp,
  TextInputProps,
  ViewStyle,
} from 'react-native';

export type TextFieldProps = Omit<TextInputProps, 'style'> & {
  /** Announced to screen readers; the field itself shows a placeholder. */
  label: string;
  /** Validation or hint text shown under the field. */
  error?: string | null;
  /** Static glyph pinned to the right of the input. */
  rightIcon?: ImageSourcePropType;
  /** Renders the show/hide password eye instead of `rightIcon`. */
  passwordToggle?: boolean;
  passwordVisible?: boolean;
  onTogglePassword?: () => void;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};
