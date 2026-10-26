import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { images } from '@/shared/assets';
import { hp, useTheme, wp } from '@/theme';

export interface HeaderProps {
  label: string;
  /** Overrides the default `goBack()` — used where a screen must tear down
   *  work in progress (a running recording) before it may leave. */
  onBackPress?: () => void;
}

/** Screen header: back arrow, title, and the brand rule beneath it. */
export function Header({ label, onBackPress }: HeaderProps) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const navigation = useNavigation();

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          hitSlop={8}
          onPress={handleBack}>
          <Image
            source={images.icon_back}
            style={styles.backIcon}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </Pressable>
        <Text style={[typography.h1, styles.label, { color: colors.primary }]}>{label}</Text>
      </View>
      <View style={[styles.rule, { backgroundColor: colors.primary }]} />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: wp(12),
    paddingVertical: hp(6.5),
  },
  backIcon: { height: hp(20), width: hp(20) },
  label: { marginLeft: wp(12) },
  rule: { height: hp(0.8) },
});
