import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from '@/shared/assets';
import { BrandLogo, Header, Icon } from '@/shared/components';
import { appVersion } from '@/shared/utils';
import { useTheme } from '@/theme';
import { SettingsSection } from '../components/SettingsSection';

const PERMISSIONS: readonly {
  icon: IconName;
  key:
    | 'permOverlay'
    | 'permCapture'
    | 'permService'
    | 'permNotifications'
    | 'permAccessibility'
    | 'permInternet';
}[] = [
  { icon: 'layers', key: 'permOverlay' },
  { icon: 'monitor', key: 'permCapture' },
  { icon: 'shieldCheck', key: 'permService' },
  { icon: 'bell', key: 'permNotifications' },
  { icon: 'accessibility', key: 'permAccessibility' },
  { icon: 'languages', key: 'permInternet' },
];

const TIPS = [
  'tipBlank',
  'tipStopped',
  'tipAccuracy',
  'tipSingleApp',
  'tipBattery',
  'tipVoice',
] as const;

/** Privacy statement, every permission with its reason, and troubleshooting. */
export default function AboutScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('about.title')} />
      <ScrollView
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.xl,
        }}
      >
        <View style={[styles.brand, { gap: spacing.sm }]}>
          <BrandLogo size={56} variant="mark" />
          <Text style={[typography.h2, { color: colors.textPrimary }]}>
            {t('common.appName')}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('about.versionLine', { version: appVersion })}
          </Text>
        </View>

        <SettingsSection title={t('about.privacyTitle')} padded>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {t('about.privacyBody')}
          </Text>
        </SettingsSection>

        <SettingsSection title={t('about.ttsTitle')} padded>
          <Text style={[typography.body, { color: colors.textPrimary }]}>
            {t('about.ttsBody')}
          </Text>
        </SettingsSection>

        <SettingsSection title={t('about.permissionsTitle')} padded>
          <View style={{ gap: spacing.lg }}>
            {PERMISSIONS.map(p => (
              <View key={p.key} style={[styles.item, { gap: spacing.md }]}>
                <Icon name={p.icon} size={20} color={colors.primaryText} />
                <View style={styles.flex}>
                  <Text
                    style={[typography.label, { color: colors.textPrimary }]}
                  >
                    {t(`about.${p.key}`)}
                  </Text>
                  <Text
                    style={[
                      typography.caption,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {t(`about.${p.key}Why`)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </SettingsSection>

        <SettingsSection title={t('about.troubleshootingTitle')} padded>
          <View style={{ gap: spacing.md }}>
            {TIPS.map(tip => (
              <View key={tip} style={[styles.item, { gap: spacing.md }]}>
                <Icon
                  name="circleHelp"
                  size={18}
                  color={colors.textSecondary}
                />
                <Text
                  style={[
                    typography.body,
                    styles.flex,
                    { color: colors.textPrimary },
                  ]}
                >
                  {t(`about.${tip}`)}
                </Text>
              </View>
            ))}
          </View>
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  brand: { alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
});
