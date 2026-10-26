import React, { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { signOut, useSession } from '@/features/session';
import { FEATURES } from '@/config';
import { setLanguage } from '@/i18n';
import { isSupportedLanguage, type LanguageCode } from '@/i18n/languages';
import { Button, Header, LanguageDropdown } from '@/shared/components';
import { appVersion } from '@/shared/utils';
import { hp, themePreference, useTheme, wp, type ThemePreference } from '@/theme';

const THEME_OPTIONS: ThemePreference[] = ['system', 'light', 'dark'];

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { top } = useSafeAreaInsets();
  const { colors, typography, radius, preference } = useTheme();
  const session = useSession();

  const language: LanguageCode = isSupportedLanguage(i18n.language) ? i18n.language : 'en';

  const onSignOut = useCallback(() => {
    Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: signOut },
    ]);
  }, [t]);

  const cardStyle = {
    backgroundColor: colors.card,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: top }]}>
      <Header label={t('settings.title')} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}>
        <View style={[styles.card, cardStyle]}>
          <Text style={[typography.caption, { color: colors.grey }]}>
            {t('settings.account')}
          </Text>
          <Text style={[typography.label, styles.cardValue, { color: colors.text }]}>
            {session?.user.name ?? t('settings.signedOut')}
          </Text>
          {session?.user.email ? (
            <Text style={[typography.caption, styles.cardValue, { color: colors.grey }]}>
              {session.user.email}
            </Text>
          ) : null}
        </View>

        <View style={[styles.card, cardStyle]}>
          <Text style={[typography.label, { color: colors.text }]}>{t('settings.theme')}</Text>
          <View style={styles.row}>
            {THEME_OPTIONS.map(option => (
              <Button
                key={option}
                label={t(`settings.theme_${option}`)}
                size="sm"
                variant={preference === option ? 'primary' : 'secondary'}
                onPress={() => themePreference.set(option)}
                accessibilityLabel={t('settings.selectTheme', {
                  theme: t(`settings.theme_${option}`),
                })}
                style={styles.themeButton}
              />
            ))}
          </View>
        </View>

        {FEATURES.languageSetting ? (
          <View style={[styles.card, cardStyle]}>
            <Text style={[typography.label, styles.cardHeading, { color: colors.text }]}>
              {t('settings.language')}
            </Text>
            <LanguageDropdown value={language} onChange={setLanguage} />
          </View>
        ) : null}

        <Button
          label={t('settings.signOut')}
          variant="danger"
          onPress={onSignOut}
          style={styles.signOut}
        />

        <Text style={[typography.caption, styles.version, { color: colors.grey }]}>
          {t('auth.version', { version: appVersion })}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: wp(16), paddingVertical: hp(12) },
  card: { borderWidth: wp(1), padding: wp(12), marginTop: hp(12) },
  cardValue: { marginTop: hp(2) },
  cardHeading: { marginBottom: hp(8) },
  row: { flexDirection: 'row', marginTop: hp(10) },
  themeButton: { flex: 1, marginHorizontal: wp(3) },
  signOut: { marginTop: hp(20) },
  version: { textAlign: 'center', marginTop: hp(14) },
});
