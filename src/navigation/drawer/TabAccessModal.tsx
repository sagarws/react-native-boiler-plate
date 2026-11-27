import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { IconName } from '@/shared/assets';
import { Button, Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  checkTabAccessPassword,
  tabAccessStore,
  useTabAccess,
  type Tab,
} from './tabAccess';

export interface TabAccessModalProps {
  visible: boolean;
  onClose: () => void;
  /** Every side-menu tab, in menu order, with its icon and label. */
  items: readonly { screen: Tab; icon: IconName; label: string }[];
}

/**
 * Hidden panel (side-menu logo tapped 5 times): enter the access password,
 * then switch each side-menu tab on or off. The unlock is forgotten when the
 * panel closes.
 */
export function TabAccessModal({
  visible,
  onClose,
  items,
}: TabAccessModalProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography, radius, shadows } = useTheme();
  const access = useTabAccess();
  const [password, setPassword] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPassword('');
    setUnlocked(false);
    setError(null);
    onClose();
  };

  const unlock = () => {
    const r = checkTabAccessPassword(password);
    if (r.ok) {
      setUnlocked(true);
      setError(null);
      setPassword('');
      return;
    }
    setError(
      r.reason === 'notSet'
        ? t('drawer.access.notSet')
        : r.reason === 'locked'
        ? t('drawer.access.locked', { seconds: r.seconds ?? 30 })
        : t('drawer.access.wrong'),
    );
  };

  const noneOn = !Object.values(access).some(Boolean);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={close}
        accessibilityLabel={t('common.cancel')}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.center}
        >
          <Pressable
            onPress={() => {}}
            testID="tab-access-modal"
            style={[
              styles.sheet,
              shadows.lg ?? null,
              {
                backgroundColor: colors.popover,
                borderColor: colors.border,
                borderRadius: radius.lg,
                padding: spacing.lg,
                marginHorizontal: spacing.lg,
              },
            ]}
          >
            <Text style={[typography.h2, { color: colors.text }]}>
              {t('drawer.access.title')}
            </Text>

            {!unlocked ? (
              <View>
                <Text
                  style={[
                    typography.body,
                    { color: colors.mutedForeground, marginTop: spacing.xs },
                  ]}
                >
                  {t('drawer.access.body')}
                </Text>
                <TextInput
                  testID="tab-access-password"
                  value={password}
                  onChangeText={text => {
                    setPassword(text);
                    if (error) setError(null);
                  }}
                  onSubmitEditing={unlock}
                  placeholder={t('drawer.access.password')}
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  style={[
                    typography.body,
                    styles.input,
                    {
                      color: colors.text,
                      backgroundColor: colors.surface,
                      borderColor: error ? colors.danger : colors.border,
                      borderRadius: radius.md,
                      paddingHorizontal: spacing.md,
                      paddingVertical: spacing.md,
                      marginTop: spacing.lg,
                    },
                  ]}
                />
                {error ? (
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.danger, marginTop: spacing.xs },
                    ]}
                  >
                    {error}
                  </Text>
                ) : null}
                <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                  <Button
                    label={t('drawer.access.unlock')}
                    onPress={unlock}
                    disabled={!password}
                  />
                  <Button
                    label={t('common.cancel')}
                    variant="secondary"
                    onPress={close}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.list}>
                <ScrollView
                  style={{ marginTop: spacing.md }}
                  showsVerticalScrollIndicator={false}
                >
                  {items.map(item => (
                    <View
                      key={item.screen}
                      style={[styles.row, { gap: spacing.md }]}
                    >
                      <Icon
                        name={item.icon}
                        size={20}
                        color={colors.primaryText}
                      />
                      <Text
                        style={[
                          typography.label,
                          styles.rowLabel,
                          { color: colors.text },
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Switch
                        testID={`tab-access-${item.screen}`}
                        value={access[item.screen]}
                        onValueChange={on => {
                          tabAccessStore.set(item.screen, on);
                        }}
                        accessibilityLabel={item.label}
                        trackColor={{
                          false: colors.disabled,
                          true: colors.primary,
                        }}
                        thumbColor={colors.surface}
                      />
                    </View>
                  ))}
                </ScrollView>
                {noneOn ? (
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.danger, marginTop: spacing.sm },
                    ]}
                  >
                    {t('drawer.access.noneOn')}
                  </Text>
                ) : null}
                <Button
                  label={t('drawer.access.done')}
                  onPress={close}
                  style={{ marginTop: spacing.lg }}
                />
              </View>
            )}
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  sheet: { borderWidth: 1, overflow: 'hidden', maxHeight: '85%' },
  list: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  rowLabel: { flex: 1 },
  input: { borderWidth: 1 },
});
