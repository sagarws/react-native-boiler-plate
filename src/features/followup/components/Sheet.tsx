import React, { type PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/shared/components';
import { categoryColor, useTheme } from '@/theme';

/** Bottom sheet used by every Follow Up quick action. */
export function Sheet({
  visible,
  title,
  subtitle,
  onClose,
  footer,
  testID,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: React.ReactNode;
  testID: string;
}>) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  if (!visible) return null;
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior="height"
        style={[styles.scrim, { backgroundColor: colors.overlay }]}
      >
        <View
          testID={testID}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderTopLeftRadius: radius.xl,
              borderTopRightRadius: radius.xl,
              paddingBottom: bottom + spacing.md,
            },
          ]}
        >
          <View
            style={[
              styles.row,
              { padding: spacing.lg, paddingBottom: spacing.sm },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[typography.title, { color: colors.textPrimary }]}>
                {title}
              </Text>
              {subtitle ? (
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              onPress={onClose}
              style={styles.close}
              testID={`${testID}-close`}
            >
              <Icon name="x" size={22} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: spacing.lg,
              paddingBottom: spacing.md,
              gap: spacing.md,
            }}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Selectable pill; [color] (a palette key) tints it when selected. */
export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  color?: string;
  icon?: React.ComponentProps<typeof Icon>['name'];
  testID?: string;
}) {
  const { colors, typography, radius, spacing } = useTheme();
  const tint = color ? categoryColor(color) : colors.primary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          gap: spacing.xs,
          backgroundColor: selected ? tint : colors.surfaceMuted,
        },
        color ? { borderColor: tint } : styles.noBorder,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={14}
          color={selected ? colors.primaryForeground : colors.textPrimary}
        />
      ) : null}
      <Text
        style={[
          typography.label,
          { color: selected ? colors.primaryForeground : colors.textPrimary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children }: PropsWithChildren) {
  const { spacing } = useTheme();
  return <View style={[styles.wrap, { gap: spacing.sm }]}>{children}</View>;
}

/** A small label + content block inside a sheet or form. */
export function Field({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  const { colors, typography, spacing } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%' },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  close: { padding: 8 },
  chip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  noBorder: { borderColor: 'transparent' },
});
