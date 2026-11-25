import React, { type PropsWithChildren } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

export type SheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  onClose: () => void;
  testID?: string;
}>;

/** A bottom sheet over the remote screen (keys, screens, quality). */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  testID,
}: SheetProps) {
  const { t } = useTranslation();
  const { bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
        accessibilityLabel={t('common.close')}
      />
      <View
        testID={testID}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingBottom: bottom + spacing.md,
          },
        ]}
      >
        <View
          style={[
            styles.header,
            { padding: spacing.lg, paddingBottom: spacing.sm },
          ]}
        >
          <Text
            style={[
              typography.title,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          >
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Text style={[typography.label, { color: colors.primary }]}>
              {t('common.done')}
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            gap: spacing.md,
          }}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { maxHeight: '75%' },
  header: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
