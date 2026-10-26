import React, { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ApiEndpointModal,
  AuthHeader,
  Button,
  SettingsIconButton,
  TextField,
} from '@/shared/components';
import { images } from '@/shared/assets';
import { FEATURES } from '@/config';
import { useKeyboardVisible } from '@/shared/hooks';
import { appVersion } from '@/shared/utils';
import { hp, useTheme, wp } from '@/theme';
import { useLogin } from '../hooks/useLogin';
import type { LoginFormValues } from '../validation/login.validation';

const EMPTY_FORM: LoginFormValues = {
  email: '',
  password: '',
};

/** Email + password sign-in. On success the root navigator swaps to Main. */
export default function LoginScreen() {
  const { t } = useTranslation();
  const { top } = useSafeAreaInsets();
  const { colors, typography } = useTheme();
  const { submitting, formError, fieldErrors, submit } = useLogin();
  const [values, setValues] = useState<LoginFormValues>(EMPTY_FORM);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [endpointOpen, setEndpointOpen] = useState(false);
  const keyboardVisible = useKeyboardVisible();

  const passwordRef = useRef<TextInput>(null);

  const setField = useCallback(
    (field: keyof LoginFormValues) => (text: string) =>
      setValues(prev => ({ ...prev, [field]: text })),
    [],
  );

  const onSubmit = useCallback(() => {
    void submit(values);
  }, [submit, values]);

  return (
    <KeyboardAvoidingView
      style={[
        styles.flex,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        // The form has to stay reachable once the keyboard takes half the
        // screen, so taps keep working while it scrolls.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.scrollContent}
      >
        <View>
          <AuthHeader compact={keyboardVisible} />
          {FEATURES.loginDevSettings ? (
            <SettingsIconButton
              accessibilityLabel={t('devSettings.open')}
              onPress={() => setEndpointOpen(true)}
              style={styles.settingsButton}
            />
          ) : null}
        </View>

        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <Text
            style={[
              typography.h1,
              keyboardVisible ? styles.titleCompact : styles.title,
              { color: colors.primary },
            ]}
          >
            {t('auth.title')}
          </Text>

          <View style={styles.form}>
            <TextField
              label={t('auth.email')}
              placeholder={t('auth.email')}
              value={values.email}
              onChangeText={setField('email')}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="next"
              rightIcon={images.icon_email}
              onSubmitEditing={() => passwordRef.current?.focus()}
              editable={!submitting}
              error={fieldErrors.email ? t(fieldErrors.email) : null}
              testID="login-email"
            />

            <TextField
              ref={passwordRef}
              label={t('auth.password')}
              placeholder={t('auth.password')}
              value={values.password}
              onChangeText={setField('password')}
              secureTextEntry={!passwordVisible}
              passwordToggle
              passwordVisible={passwordVisible}
              onTogglePassword={() => setPasswordVisible(visible => !visible)}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={onSubmit}
              editable={!submitting}
              error={fieldErrors.password ? t(fieldErrors.password) : null}
              testID="login-password"
            />

            {formError ? (
              <Text
                accessibilityLiveRegion="assertive"
                style={[
                  typography.body,
                  styles.formError,
                  { color: colors.red },
                ]}
              >
                {formError.message ?? t('common.somethingWentWrong')}
              </Text>
            ) : null}
          </View>

          <View style={keyboardVisible ? styles.footerCompact : styles.footer}>
            <Button
              label={t('auth.signIn')}
              loading={submitting}
              onPress={onSubmit}
              style={styles.submit}
              testID="login-submit"
            />
            <Text
              style={[
                typography.caption,
                styles.version,
                { color: colors.grey },
              ]}
            >
              {t('auth.version', { version: appVersion })}
            </Text>
          </View>
        </View>
      </ScrollView>

      <ApiEndpointModal
        visible={endpointOpen}
        onClose={() => setEndpointOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  sheet: { flexGrow: 1 },
  title: { alignSelf: 'center', marginTop: hp(45), marginBottom: hp(30) },
  titleCompact: {
    alignSelf: 'center',
    marginTop: hp(12),
    marginBottom: hp(12),
  },
  form: { paddingHorizontal: wp(17) },
  formError: { marginTop: hp(6), textAlign: 'center' },
  footer: {
    paddingHorizontal: wp(17),
    paddingTop: hp(20),
    paddingBottom: hp(24),
  },
  footerCompact: {
    paddingHorizontal: wp(17),
    paddingTop: hp(10),
    paddingBottom: hp(12),
  },
  submit: { marginVertical: hp(6) },
  version: { textAlign: 'center', marginTop: hp(16) },
  settingsButton: { position: 'absolute', top: hp(10), right: wp(15) },
});
