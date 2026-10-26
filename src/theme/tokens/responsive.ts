import { Dimensions, PixelRatio, Platform, StatusBar } from 'react-native';

/**
 * Screen-relative sizing.
 *
 * The previous app laid every screen out against a 344x679pt reference device
 * and scaled type with `react-native-responsive-fontsize`. Reproducing those
 * formulas here keeps the restored UI pixel-accurate without pulling the two
 * libraries back in — both are thin wrappers over `Dimensions`.
 */

const REFERENCE_WIDTH = 344;
const REFERENCE_HEIGHT = 679;
const REFERENCE_FONT_HEIGHT = 812;

export const isIos = Platform.OS === 'ios';

function screen() {
  return Dimensions.get('window');
}

/** Height in dp for a measurement taken on the 679pt-tall reference device. */
export function hp(value: number): number {
  const { height, width } = screen();
  const longest = Math.max(height, width);
  return PixelRatio.roundToNearestPixel((longest * value) / REFERENCE_HEIGHT);
}

/** Width in dp for a measurement taken on the 344pt-wide reference device. */
export function wp(value: number): number {
  const { height, width } = screen();
  const shortest = Math.min(height, width);
  return PixelRatio.roundToNearestPixel((shortest * value) / REFERENCE_WIDTH);
}

/** Type scale, matching `RFValue(value, 812)` from the previous app. */
export function fontSize(value: number): number {
  const { height, width } = screen();
  const standardLength = Math.max(width, height);
  // Portrait phones lose the status bar from the usable height; the original
  // library applied the same offset, and dropping it would shift every label.
  const offset = width > height ? 0 : isIos ? 78 : StatusBar.currentHeight ?? 0;
  const deviceHeight = standardLength - offset;
  return Math.round((value * deviceHeight) / REFERENCE_FONT_HEIGHT);
}
