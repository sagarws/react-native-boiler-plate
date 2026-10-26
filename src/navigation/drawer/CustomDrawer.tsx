import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut, useSession } from '@/features/session';
import { images } from '@/shared/assets';
import { hp, isIos, useTheme, wp } from '@/theme';
import { useDrawer } from './DrawerContext';
import { ROUTES } from '../routes';
import type { MainStackParamList } from '../types';

/**
 * Side panel: who is signed in, the screens that sit outside the main flow,
 * and the way out. Add a nav row per screen you want reachable from here.
 */
export function CustomDrawer() {
  const { t } = useTranslation();
  const { top } = useSafeAreaInsets();
  const { colors, typography } = useTheme();
  const navigation = useNavigation();
  const { closeDrawer } = useDrawer();
  const session = useSession();

  // The drawer wraps the main stack rather than living inside it, so this
  // navigation object belongs to the ROOT navigator — which knows nothing of
  // `Settings`. Targeting main-stack screens needs the nested form.
  const go = (screen: keyof MainStackParamList) => () => {
    closeDrawer();
    navigation.navigate(ROUTES.MAIN, { screen });
  };

  const onLogoutPress = () => {
    Alert.alert(
      t('settings.signOut'),
      t('settings.signOutConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: () => {
            closeDrawer();
            signOut();
          },
        },
      ],
      { cancelable: true },
    );
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.primary, paddingTop: isIos ? top : hp(20) },
      ]}>
      <View style={[styles.logoRing, { backgroundColor: colors.surface }]}>
        <Image
          source={images.icon_app_logo}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
      <View style={styles.spacer} />

      <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <View style={[styles.field, { borderBottomColor: colors.surface2 }]}>
          <Text style={[typography.label, { color: colors.primary }]} numberOfLines={2}>
            {session?.user.name || t('drawer.notAvailable')}
          </Text>
          <Text style={[typography.body, { color: colors.grey }]} numberOfLines={2}>
            {session?.user.email || t('drawer.notAvailable')}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('drawer.settings')}
          style={styles.navRow}
          onPress={go(ROUTES.SETTINGS)}>
          <Text style={[typography.label, styles.navLabel, { color: colors.text }]}>
            {t('drawer.settings')}
          </Text>
        </Pressable>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.signOut')}
            style={[styles.logoutRow, { borderTopColor: colors.primary }]}
            onPress={onLogoutPress}>
            <Image
              source={images.icon_logout}
              style={styles.logoutIcon}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <Text style={[typography.label, styles.logoutLabel, { color: colors.text }]}>
              {t('settings.signOut')}
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  logoRing: { padding: hp(10), borderRadius: hp(100), alignSelf: 'center' },
  logo: { width: hp(60), height: hp(60), alignSelf: 'center' },
  spacer: { height: hp(10) },
  sheet: {
    flex: 1,
    borderTopLeftRadius: wp(14),
    borderTopRightRadius: wp(14),
    paddingTop: hp(10),
  },
  field: {
    marginBottom: hp(14),
    paddingVertical: hp(8),
    borderBottomWidth: 1,
    paddingLeft: wp(8),
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: wp(20),
    paddingRight: wp(16),
    paddingVertical: hp(10),
  },
  navLabel: { flex: 1 },
  footer: { flex: 1, justifyContent: 'flex-end', paddingBottom: hp(isIos ? 30 : 15) },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: wp(0.8),
    paddingLeft: wp(20),
    paddingTop: hp(8),
  },
  logoutIcon: { height: hp(20), width: hp(20) },
  logoutLabel: { marginLeft: wp(20) },
});
