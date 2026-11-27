import React, { useRef, useState } from 'react';
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
import { TabAccessModal } from './TabAccessModal';
import { useTabAccess } from './tabAccess';
import { ROUTES } from '../routes';
import type { MainStackParamList } from '../types';

type DrawerTarget =
  | 'ExpenseTracker'
  | 'Dashboard'
  | 'FileManagement'
  | 'ManageLife'
  | 'FollowUp'
  | 'Reminders'
  | 'PhotoWidgets'
  | 'Utility'
  | 'NetworkInspector'
  | 'RemoteAccess'
  | 'LiveCamera'
  | 'AudioStudio'
  | 'Settings'
  | 'Appearance'
  | 'About';

/** Logo taps, each within this long of the last, that open the tab-access panel. */
const SECRET_TAPS = 5;
const SECRET_TAP_GAP_MS = 800;

const ITEMS: readonly {
  screen: DrawerTarget;
  icon: IconName;
  label:
    | 'expense'
    | 'home'
    | 'files'
    | 'life'
    | 'followUp'
    | 'reminders'
    | 'photoWidget'
    | 'utility'
    | 'network'
    | 'remote'
    | 'liveCamera'
    | 'audioStudio'
    | 'settings'
    | 'appearance'
    | 'about';
}[] = [
  { screen: ROUTES.EXPENSE_TRACKER, icon: 'wallet', label: 'expense' },
  { screen: ROUTES.MANAGE_LIFE, icon: 'gauge', label: 'life' },
  { screen: ROUTES.DASHBOARD, icon: 'scanText', label: 'home' },
  { screen: ROUTES.FILE_MANAGEMENT, icon: 'folder', label: 'files' },
  { screen: ROUTES.FOLLOW_UP, icon: 'users', label: 'followUp' },
  { screen: ROUTES.REMINDERS, icon: 'bell', label: 'reminders' },
  { screen: ROUTES.PHOTO_WIDGETS, icon: 'image', label: 'photoWidget' },
  { screen: ROUTES.UTILITY, icon: 'wrench', label: 'utility' },
  { screen: ROUTES.NETWORK_INSPECTOR, icon: 'globe', label: 'network' },
  { screen: ROUTES.REMOTE_ACCESS, icon: 'monitor', label: 'remote' },
  { screen: ROUTES.LIVE_CAMERA, icon: 'camera', label: 'liveCamera' },
  { screen: ROUTES.AUDIO_STUDIO, icon: 'headphones', label: 'audioStudio' },
  { screen: ROUTES.SETTINGS, icon: 'settings', label: 'settings' },
  { screen: ROUTES.APPEARANCE, icon: 'palette', label: 'appearance' },
  { screen: ROUTES.ABOUT, icon: 'shieldCheck', label: 'about' },
];

/**
 * Side panel: the brand, the main destinations (only the tabs switched on in
 * tabAccess.ts — tap the logo 5 times to change them) and — only when the
 * boilerplate's auth is switched on — the signed-in user and sign out.
 */
export function CustomDrawer() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const navigation = useNavigation();
  const { closeDrawer } = useDrawer();
  const session = useSession();
  const access = useTabAccess();
  const visibleItems = ITEMS.filter(item => access[item.screen]);

  // Tapping the logo 5 times (each within 800 ms of the last) opens the
  // hidden tab-access panel.
  const [accessOpen, setAccessOpen] = useState(false);
  const taps = useRef({ count: 0, last: 0 });
  const onLogoPress = () => {
    const now = Date.now();
    const tp = taps.current;
    tp.count = now - tp.last <= SECRET_TAP_GAP_MS ? tp.count + 1 : 1;
    tp.last = now;
    if (tp.count >= SECRET_TAPS) {
      tp.count = 0;
      setAccessOpen(true);
    }
  };

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
        <Pressable
          onPress={onLogoPress}
          testID="drawer-logo"
          accessible={false}
          style={styles.logo}
        >
          <BrandLogo size={44} variant="lockupLight" />
        </Pressable>
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
        {visibleItems.map(item => (
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

      <TabAccessModal
        visible={accessOpen}
        onClose={() => setAccessOpen(false)}
        items={ITEMS.map(item => ({
          ...item,
          label: t(`drawer.${item.label}`),
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  logo: { alignSelf: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  items: { flexGrow: 1, flexShrink: 1 },
  footer: { justifyContent: 'flex-end' },
});
