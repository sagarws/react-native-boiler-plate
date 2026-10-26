import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import {
  SUPPORTED_LANGUAGES,
  type LanguageCode,
} from '@/i18n/languages';

export type LanguageDropdownTone = 'default' | 'dark';

export interface LanguageDropdownProps {
  value: LanguageCode;
  onChange: (code: LanguageCode) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Compact pill trigger (flag only) — fits hero/header rows. */
  compact?: boolean;
  /** Match the surface the trigger sits on. */
  tone?: LanguageDropdownTone;
}

export function LanguageDropdown({
  value,
  onChange,
  accessibilityLabel,
  style,
  compact = false,
  tone = 'default',
}: LanguageDropdownProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography, radius, shadows } = useTheme();
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => SUPPORTED_LANGUAGES.find(l => l.code === value) ?? SUPPORTED_LANGUAGES[0],
    [value],
  );

  const dark = tone === 'dark';
  const triggerBg = dark ? colors.sidebarAccent : colors.surface;
  const triggerBorder = open
    ? colors.ring
    : dark
      ? colors.sidebarBorder
      : colors.border;
  const triggerText = dark ? colors.sidebarForeground : colors.text;
  const triggerMuted = dark
    ? colors.sidebarForeground
    : colors.mutedForeground;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: triggerBg,
            borderColor: triggerBorder,
            borderWidth: 1,
            borderRadius: compact ? radius.pill : radius.md,
            paddingHorizontal: compact ? spacing.md : spacing.md,
            paddingVertical: compact ? spacing.xs : spacing.md,
            opacity: pressed ? 0.85 : 1,
          },
          style,
        ]}>
        <Text
          style={[
            typography.body,
            { fontSize: compact ? 16 : 20, marginRight: spacing.xs },
          ]}>
          {selected.flag}
        </Text>
        {compact ? (
          <Text
            style={[
              typography.caption,
              {
                color: triggerText,
                fontWeight: '600',
                letterSpacing: 0.6,
                marginRight: spacing.xs,
              },
            ]}>
            {selected.code.toUpperCase()}
          </Text>
        ) : (
          <Text style={[typography.body, { color: triggerText, flex: 1 }]}>
            {selected.label}
          </Text>
        )}
        <Text
          style={[
            typography.caption,
            {
              color: triggerMuted,
              opacity: dark ? 0.8 : 1,
              transform: [{ rotate: open ? '180deg' : '0deg' }],
            },
          ]}>
          ⌄
        </Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setOpen(false)}>
        <Pressable
          style={[styles.backdrop, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
          onPress={() => setOpen(false)}
          accessibilityLabel={t('common.cancel') ?? 'Cancel'}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.sheet,
              shadows.lg ?? null,
              {
                backgroundColor: colors.popover,
                borderColor: colors.border,
                borderRadius: radius.lg,
                paddingVertical: spacing.sm,
                marginHorizontal: spacing.lg,
              },
            ]}>
            {SUPPORTED_LANGUAGES.map(lang => {
              const isSelected = lang.code === value;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => {
                    onChange(lang.code);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  style={({ pressed }) => [
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingHorizontal: spacing.lg,
                      paddingVertical: spacing.md,
                      backgroundColor: pressed ? colors.muted : 'transparent',
                    },
                  ]}>
                  <Text style={{ fontSize: 22, marginRight: spacing.md }}>{lang.flag}</Text>
                  <Text style={[typography.body, { color: colors.text, flex: 1 }]}>
                    {lang.label}
                  </Text>
                  {isSelected ? (
                    <Text style={[typography.body, { color: colors.primary, fontWeight: '700' }]}>
                      ✓
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center' },
  sheet: { borderWidth: 1, overflow: 'hidden' },
});
