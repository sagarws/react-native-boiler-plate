import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FEATURES } from '@/config';
import { signOut, useSession } from '@/features/session';
import type { IconName } from '@/shared/assets';
import { BrandLogo, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import { useDrawer } from './DrawerContext';
import { ROUTES } from '../routes';
import type { MainStackParamList } from '../types';

type DrawerTarget =
  | 'Dashboard'
  | 'FileManagement'
  | 'ManageLife'
  | 'FollowUp'
  | 'Utility'
  | 'Settings'
  | 'Appearance'
  | 'About';

const ITEMS: readonly {
  screen: DrawerTarget;
  icon: IconName;
  label:
    | 'home'
    | 'files'
    | 'life'
    | 'followUp'
    | 'utility'
    | 'settings'
    | 'appearance'
    | 'about';
}[] = [
  { screen: ROUTES.MANAGE_LIFE, icon: 'gauge', label: 'life' },
  { screen: ROUTES.DASHBOARD, icon: 'scanText', label: 'home' },
  { screen: ROUTES.FILE_MANAGEMENT, icon: 'folder', label: 'files' },
  { screen: ROUTES.FOLLOW_UP, icon: 'users', label: 'followUp' },
  { screen: ROUTES.UTILITY, icon: 'wrench', label: 'utility' },
  { screen: ROUTES.SETTINGS, icon: 'settings', label: 'settings' },
  { screen: ROUTES.APPEARANCE, icon: 'palette', label: 'appearance' },
  { screen: ROUTES.ABOUT, icon: 'shieldCheck', label: 'about' },
];

/**
 * Side panel: the brand, the main destinations and — only when the
 * boilerplate's auth is switched on — the signed-in user and sign out.
 */
export function CustomDrawer() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { closeDrawer } = useDrawer();
  const session = useSession();

  // The drawer wraps the main stack rather than living inside it, so this
  // navigation object belongs to the ROOT navigator. Targeting main-stack
  // screens needs the nested form.
  const go = (screen: keyof MainStackParamList & DrawerTarget) => () => {
    closeDrawer();
    navigation.navigate(ROUTES.MAIN, { screen });
  };

  const onLogoutPress = () => {
    Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.signOut'),
        style: 'destructive',
        onPress: () => {
          closeDrawer();
          signOut();
        },
      },
    ]);
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.surface, paddingBottom: bottom + spacing.lg },
      ]}
    >
      <View
        style={{
          backgroundColor: colors.primary,
          paddingTop: top + spacing.xl,
          padding: spacing.lg,
        }}
      >
        <BrandLogo size={44} variant="lockupLight" />
        <Text
          style={[
            typography.caption,
            {
              color: colors.primaryForeground,
              marginTop: spacing.sm,
              opacity: 0.85,
            },
          ]}
        >
          {t('common.tagline')}
        </Text>
        {FEATURES.auth && session ? (
          <Text
            style={[
              typography.body,
              { color: colors.primaryForeground, marginTop: spacing.sm },
            ]}
            numberOfLines={1}
          >
            {session.user.name || t('drawer.notAvailable')}
          </Text>
        ) : null}
      </View>

      {/* Scrolls when the list is taller than the screen (e.g. landscape). */}
      <ScrollView
        style={styles.items}
        contentContainerStyle={{ padding: spacing.sm, gap: spacing.xs }}
      >
        {ITEMS.map(item => (
          <Pressable
            key={item.screen}
            accessibilityRole="button"
            accessibilityLabel={t(`drawer.${item.label}`)}
            onPress={go(item.screen)}
            style={({ pressed }) => [
              styles.row,
              {
                borderRadius: radius.lg,
                paddingHorizontal: spacing.md,
                gap: spacing.md,
              },
              pressed && { backgroundColor: colors.primarySoft },
            ]}
          >
            <Icon name={item.icon} size={20} color={colors.primaryText} />
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t(`drawer.${item.label}`)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {FEATURES.auth ? (
        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('settings.signOut')}
            style={[
              styles.row,
              { paddingHorizontal: spacing.lg, gap: spacing.md },
            ]}
            onPress={onLogoutPress}
          >
            <Icon name="power" size={20} color={colors.error} />
            <Text style={[typography.label, { color: colors.error }]}>
              {t('settings.signOut')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  items: { flexGrow: 1, flexShrink: 1 },
  footer: { justifyContent: 'flex-end' },
});
