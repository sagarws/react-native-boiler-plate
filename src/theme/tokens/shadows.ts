import { Platform, type ViewStyle } from 'react-native';

type ShadowSpec = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

const ios = (
  shadowOffset: { width: number; height: number },
  shadowOpacity: number,
  shadowRadius: number,
): ShadowSpec => ({
  shadowColor: '#000',
  shadowOffset,
  shadowOpacity,
  shadowRadius,
});

const android = (elevation: number): ShadowSpec => ({ elevation });

export const shadows = {
  none: {} satisfies ShadowSpec,
  sm: Platform.select({
    ios: ios({ width: 0, height: 1 }, 0.08, 2),
    default: android(1),
  }) as ShadowSpec,
  md: Platform.select({
    ios: ios({ width: 0, height: 2 }, 0.12, 6),
    default: android(3),
  }) as ShadowSpec,
  lg: Platform.select({
    ios: ios({ width: 0, height: 4 }, 0.16, 12),
    default: android(6),
  }) as ShadowSpec,
} as const;

export type ShadowKey = keyof typeof shadows;
