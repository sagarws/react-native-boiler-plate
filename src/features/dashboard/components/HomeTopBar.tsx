import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BrandLogo, Icon } from '@/shared/components';
import { useTheme } from '@/theme';

export interface HomeTopBarProps {
  onMenu: () => void;
  onSettings: () => void;
}

export function HomeTopBar({ onMenu, onSettings }: HomeTopBarProps) {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();

  const iconButton = (
    label: string,
    icon: 'menu' | 'settings',
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon name={icon} size={22} color={colors.textPrimary} />
    </Pressable>
  );

  return (
    <View style={[styles.row, { paddingHorizontal: spacing.sm }]}>
      {iconButton(t('home.openMenu'), 'menu', onMenu, 'home-menu')}
      <BrandLogo size={32} style={styles.brand} />
      {iconButton(
        t('home.openSettings'),
        'settings',
        onSettings,
        'home-settings',
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  brand: { flex: 1, marginLeft: 4 },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
