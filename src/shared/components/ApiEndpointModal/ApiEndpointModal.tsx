import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/theme';
import {
  clearApiBaseUrlOverride,
  getApiBaseUrlOverride,
  getDefaultApiBaseUrl,
  isValidEndpoint,
  setApiBaseUrlOverride,
} from '@/config';
import { Button } from '../Button';

export interface ApiEndpointModalProps {
  visible: boolean;
  onClose: () => void;
}

// Developer sheet for pointing the build at a different backend without a
// rebuild. The override lives in MMKV, so it survives restarts, and every
// consumer (REST client, socket) reads through `getApiBaseUrl()` — saving
// here reroutes the whole app.
export function ApiEndpointModal({ visible, onClose }: ApiEndpointModalProps) {
  const { t } = useTranslation();
  const { colors, spacing, typography, radius, shadows } = useTheme();

  const defaultApiUrl = useMemo(() => getDefaultApiBaseUrl(), []);
  const [apiValue, setApiValue] = useState<string>('');
  const [apiError, setApiError] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) return;
    setApiError(undefined);
    setApiValue(getApiBaseUrlOverride() ?? defaultApiUrl);
  }, [visible, defaultApiUrl]);

  function handleSave() {
    const trimmed = apiValue.trim();
    if (!isValidEndpoint(trimmed)) {
      setApiError(t('devSettings.errorInvalid'));
      return;
    }
    setApiBaseUrlOverride(trimmed);
    onClose();
  }

  function handleReset() {
    clearApiBaseUrlOverride();
    setApiValue(defaultApiUrl);
    setApiError(undefined);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}>
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.scrim }]}
        onPress={onClose}
        accessibilityLabel={t('common.cancel') ?? 'Cancel'}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.center}>
          <Pressable
            onPress={() => {}}
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
            ]}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <Text style={[typography.h2, { color: colors.text }]}>
                {t('devSettings.title')}
              </Text>
              <Text
                style={[
                  typography.body,
                  { color: colors.mutedForeground, marginTop: spacing.xs },
                ]}>
                {t('devSettings.body')}
              </Text>

              <Text
                style={[
                  typography.caption,
                  {
                    color: colors.mutedForeground,
                    marginTop: spacing.lg,
                    marginBottom: spacing.xs,
                  },
                ]}>
                {t('devSettings.label')}
              </Text>
              <TextInput
                value={apiValue}
                onChangeText={text => {
                  setApiValue(text);
                  if (apiError) setApiError(undefined);
                }}
                placeholder={t('devSettings.placeholder') ?? 'https://...'}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  typography.body,
                  {
                    color: colors.text,
                    backgroundColor: colors.surface,
                    borderColor: apiError ? colors.danger : colors.border,
                    borderWidth: 1,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.md,
                  },
                ]}
              />
              {apiError ? (
                <Text
                  style={[
                    typography.caption,
                    { color: colors.danger, marginTop: spacing.xs },
                  ]}>
                  {apiError}
                </Text>
              ) : null}
              <Text
                style={[
                  typography.caption,
                  { color: colors.mutedForeground, marginTop: spacing.xs },
                ]}>
                {t('devSettings.defaultPrefix')} {defaultApiUrl}
              </Text>

              <View style={{ marginTop: spacing.lg }}>
                <Button label={t('devSettings.save')} onPress={handleSave} />
                <Button
                  label={t('devSettings.reset')}
                  variant="secondary"
                  onPress={handleReset}
                  style={{ marginTop: spacing.sm }}
                />
                <Pressable
                  onPress={onClose}
                  style={{
                    marginTop: spacing.md,
                    alignSelf: 'center',
                    paddingVertical: spacing.xs,
                  }}>
                  <Text style={[typography.body, { color: colors.mutedForeground }]}>
                    {t('common.cancel')}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
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
});
