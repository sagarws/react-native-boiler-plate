import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
// The context module only (not the drawer's index, which renders shared
// components itself — that would be an import cycle).
import { useDrawer } from '@/navigation/drawer/DrawerContext';
import { useTheme } from '@/theme';
import { Icon } from '../Icon';

export interface HeaderProps {
  label: string;
  /** Overrides the default `goBack()` — used where a screen must tear down
   *  work in progress before it may leave. */
  onBackPress?: () => void;
  /** Actions on the right edge. */
  right?: ReactNode;
  /** Shows a menu button (opens the side drawer) instead of back — for a
   *  screen at the root of the stack. */
  onMenuPress?: () => void;
}

/**
 * Screen header: back button, side-menu button, title, optional actions.
 * Every screen under the side panel gets the menu button, so the side menu
 * opens from any sub-screen without going back first.
 */
export function Header({
  label,
  onBackPress,
  right,
  onMenuPress,
}: HeaderProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const drawer = useDrawer();
  // Root screens pass onMenuPress (menu only); sub-screens get back + menu.
  const showMenu = !onMenuPress && drawer.available;

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View
      style={[
        styles.row,
        { paddingHorizontal: spacing.sm, borderBottomColor: colors.divider },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          onMenuPress ? t('common.openMenu') : t('common.back')
        }
        onPress={onMenuPress ?? handleBack}
        style={({ pressed }) => [
          styles.back,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <Icon
          name={onMenuPress ? 'menu' : 'arrowLeft'}
          size={22}
          color={colors.textPrimary}
        />
      </Pressable>
      {showMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.openMenu')}
          onPress={drawer.openDrawer}
          testID="header-menu"
          style={({ pressed }) => [
            styles.back,
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Icon name="menu" size={22} color={colors.textPrimary} />
        </Pressable>
      ) : null}
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[typography.h2, styles.label, { color: colors.textPrimary }]}
      >
        {label}
      </Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1, marginLeft: 4 },
  right: { flexDirection: 'row', alignItems: 'center' },
});
