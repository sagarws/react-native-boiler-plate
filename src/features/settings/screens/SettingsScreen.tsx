import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FEATURES } from '@/config';
import {
  clearAllCaptures,
  OcrModePicker,
  useCaptureSettings,
  useOverlayController,
} from '@/features/capture';
import { signOut } from '@/features/session';
import { setLanguage } from '@/i18n';
import { isSupportedLanguage, type LanguageCode } from '@/i18n/languages';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  ExpandableCard,
  Header,
  LanguageDropdown,
  ListRow,
  Notice,
} from '@/shared/components';
import { appVersion } from '@/shared/utils';
import { useTheme } from '@/theme';
import { FloatingButtonSection } from '../components/FloatingButtonSection';
import { PaginationSection } from '../components/PaginationSection';
import { ReadingSection } from '../components/ReadingSection';
import { SettingsSection } from '../components/SettingsSection';
import { SettingSwitch } from '../components/SettingControls';
import { SpeechSection } from '../components/SpeechSection';

type Toast = 'historyCleared' | 'resetPositionDone' | null;

/** The large, collapsible sections; only one is open at a time. */
type SectionKey =
  | 'ocr'
  | 'floating'
  | 'speech'
  | 'reading'
  | 'pagination'
  | 'clipboard';

/**
 * Settings, grouped: OCR language · Floating button · Speech & voice ·
 * Auto-scroll reading · Speak with pagination · Clipboard & history ·
 * Appearance · About & privacy. The large groups are an accordion — one open
 * at a time, each collapsed to a one-line summary of its current state —
 * so everything fits without long scrolling.
 * Every control writes through the capture settings store, which persists
 * immediately and is mirrored to the native service.
 */
export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, preset, typographyPreset } = useTheme();
  const navigation = useNavigation();
  const { settings, update } = useCaptureSettings();
  const overlay = useOverlayController();
  const [toast, setToast] = useState<Toast>(null);
  const [open, setOpen] = useState<SectionKey | null>(null);
  const section = (key: SectionKey) => ({
    expanded: open === key,
    onToggle: () => setOpen(current => (current === key ? null : key)),
  });
  const onOff = (value: boolean) => (value ? t('common.on') : t('common.off'));

  const language: LanguageCode = isSupportedLanguage(i18n.language)
    ? i18n.language
    : 'en';

  const onClearHistory = useCallback(() => {
    Alert.alert(
      t('settings.clearHistoryConfirmTitle'),
      t('settings.clearHistoryConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.clearHistory'),
          style: 'destructive',
          onPress: () => {
            clearAllCaptures();
            setToast('historyCleared');
          },
        },
      ],
    );
  }, [t]);

  const onSignOut = useCallback(() => {
    Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: signOut },
    ]);
  }, [t]);

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('settings.title')} />
      <ScrollView
        testID="settings-scroll"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        {toast ? (
          <Notice
            tone="success"
            message={t(`settings.${toast}`)}
            onDismiss={() => setToast(null)}
          />
        ) : null}

        <ExpandableCard
          title={t('ocrMode.label')}
          summary={t(`ocrMode.${settings.ocrMode}`)}
          icon="languages"
          footer={`${t('settings.ocrHint')} ${t('ocrMode.engineNote')}`}
          padded
          testID="settings-ocr"
          {...section('ocr')}
        >
          <OcrModePicker
            value={settings.ocrMode}
            onChange={ocrMode => update({ ocrMode })}
          />
        </ExpandableCard>

        <FloatingButtonSection
          overlay={overlay}
          onResetPosition={() => setToast('resetPositionDone')}
          {...section('floating')}
        />

        <SpeechSection {...section('speech')} />

        <ReadingSection {...section('reading')} />

        <PaginationSection {...section('pagination')} />

        <ExpandableCard
          title={t('settings.sectionClipboard')}
          summary={t('settings.summaryClipboard', {
            copy: onOff(settings.autoCopy),
            history: onOff(settings.saveHistory),
          })}
          icon="clipboardCheck"
          footer={t('settings.privacyNote')}
          testID="settings-clipboard"
          {...section('clipboard')}
        >
          <ListRow
            icon="clipboardCheck"
            title={t('settings.autoCopy')}
            subtitle={t('settings.autoCopyHint')}
            right={
              <SettingSwitch
                testID="settings-auto-copy"
                value={settings.autoCopy}
                onChange={autoCopy => update({ autoCopy })}
                label={t('settings.autoCopy')}
              />
            }
          />
          <ListRow
            divider
            icon="history"
            title={t('settings.saveHistory')}
            subtitle={t('settings.saveHistoryHint')}
            right={
              <SettingSwitch
                testID="settings-save-history"
                value={settings.saveHistory}
                onChange={saveHistory => update({ saveHistory })}
                label={t('settings.saveHistory')}
              />
            }
          />
          <ListRow
            divider
            destructive
            icon="trash2"
            title={t('settings.clearHistory')}
            onPress={onClearHistory}
            testID="settings-clear-history"
          />
        </ExpandableCard>

        <SettingsSection title={t('settings.sectionAppearance')}>
          <ListRow
            icon="palette"
            title={t('settings.appearanceRow')}
            subtitle={`${t(`appearance.preset_${preset}`)} · ${t(
              `appearance.typography_${typographyPreset}`,
            )}`}
            onPress={() => navigation.navigate(ROUTES.APPEARANCE)}
            testID="settings-appearance"
          />
        </SettingsSection>

        {FEATURES.languageSetting ? (
          <SettingsSection title={t('settings.language')} padded>
            <LanguageDropdown value={language} onChange={setLanguage} />
          </SettingsSection>
        ) : null}

        <SettingsSection title={t('settings.sectionAbout')}>
          <ListRow
            icon="shieldCheck"
            title={t('settings.aboutRow')}
            onPress={() => navigation.navigate(ROUTES.ABOUT)}
            testID="settings-about"
          />
          <ListRow
            divider
            icon="info"
            title={t('settings.version')}
            right={
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                {appVersion}
              </Text>
            }
          />
        </SettingsSection>

        {FEATURES.auth ? (
          <Button
            label={t('settings.signOut')}
            variant="danger"
            onPress={onSignOut}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
