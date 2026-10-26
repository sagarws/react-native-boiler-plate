import { StyleSheet } from 'react-native';

// Heights keep every size at or above the 48dp touch target, except `sm`,
// which pads its hit area with `hitSlop` in Button.tsx.
export const buttonStyles = StyleSheet.create({
  base: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    paddingHorizontal: 16,
    gap: 8,
  },
  lg: { minHeight: 56 },
  md: { minHeight: 48 },
  sm: { minHeight: 40, paddingHorizontal: 12 },
  icon: { height: 18, width: 18 },
});
