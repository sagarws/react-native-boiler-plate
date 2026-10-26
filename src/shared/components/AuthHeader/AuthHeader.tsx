import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { images } from '@/shared/assets';
import { hp, wp } from '@/theme';

export interface AuthHeaderProps {
  /**
   * Drops the large brand mark. The keyboard takes roughly half the screen,
   * and the illustration is the one thing on this screen that can go without
   * costing the user anything.
   */
  compact?: boolean;
}

/** Brand lockup that sits above the sign-in form. */
export function AuthHeader({ compact = false }: AuthHeaderProps) {
  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      <View style={styles.row}>
        <Image
          source={images.icon_logo}
          style={styles.wordmark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
      {compact ? null : (
        <Image
          source={images.icon_common_logo}
          style={styles.mark}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: hp(24) },
  containerCompact: { paddingTop: hp(10), paddingBottom: hp(4) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: wp(15),
  },
  wordmark: { height: hp(30), width: wp(115), marginBottom: hp(10) },
  mark: { height: hp(168), width: hp(168), alignSelf: 'center' },
});
