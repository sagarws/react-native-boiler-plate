import React, { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import { Icon } from '../Icon';

export interface HeaderProps {
  label: string;
  /** Overrides the default `goBack()` — used where a screen must tear down
   *  work in progress before it may leave. */
  onBackPress?: () => void;
  /** Actions on the right edge. */
  right?: ReactNode;
}

/** Screen header: back button, title, optional actions. */
export function Header({ label, onBackPress, right }: HeaderProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();

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
        accessibilityLabel={t('common.back')}
        onPress={handleBack}
        style={({ pressed }) => [
          styles.back,
          pressed && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        <Icon name="arrowLeft" size={22} color={colors.textPrimary} />
      </Pressable>
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
