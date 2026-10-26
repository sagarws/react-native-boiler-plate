import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/features/session';
import { useDrawer } from '@/navigation/drawer';
import { images } from '@/shared/assets';
import { hp, useTheme, wp } from '@/theme';

/**
 * Landing screen after sign-in: the drawer button and a welcome. Replace the
 * body with your app's home content; push further screens from here.
 */
export default function DashboardScreen() {
  const { t } = useTranslation();
  const { top } = useSafeAreaInsets();
  const { colors, typography } = useTheme();
  const { openDrawer } = useDrawer();
  const session = useSession();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: top }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dashboard.openMenu')}
        hitSlop={12}
        onPress={openDrawer}
        style={styles.drawerButton}>
        <Image
          source={images.icon_drawer}
          style={[styles.drawerIcon, { tintColor: colors.primary }]}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </Pressable>

      <View style={styles.body}>
        <Image
          source={images.icon_app_logo}
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={[typography.h1, styles.title, { color: colors.text }]}>
          {session?.user.name
            ? t('dashboard.welcomeName', { name: session.user.name })
            : t('dashboard.welcome')}
        </Text>
        <Text style={[typography.body, styles.subtitle, { color: colors.grey }]}>
          {t('dashboard.subtitle')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  drawerButton: { height: hp(20), width: hp(20), marginLeft: wp(6), marginTop: hp(6) },
  drawerIcon: { height: hp(24), width: hp(24) },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: wp(24),
    paddingBottom: hp(20),
  },
  logo: { height: hp(96), width: hp(96) },
  title: { marginTop: hp(20), textAlign: 'center' },
  subtitle: { marginTop: hp(8), textAlign: 'center' },
});
