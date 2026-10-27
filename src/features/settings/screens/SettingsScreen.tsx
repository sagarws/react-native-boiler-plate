import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
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
import { TranslateSection } from '../components/TranslateSection';
import { RefineSection } from '../components/RefineSection';
import { AudioShareSection } from '../components/AudioShareSection';
import { GeminiSection } from '../components/GeminiSection';
import { SettingsTabs, type SettingsTab } from '../components/SettingsTabs';
import { DriveCredentialsSection } from '../components/DriveCredentialsSection';
import type { MainStackParamList } from '@/navigation/types';

type Toast = 'historyCleared' | 'resetPositionDone' | null;

/** The large, collapsible sections; only one is open at a time. */
type SectionKey =
  | 'ocr'
  | 'floating'
  | 'speech'
  | 'reading'
  | 'pagination'
  | 'refine'
  | 'audioShare'
  | 'translate'
  | 'gemini'
  | 'driveCreds'
  | 'clipboard';

/**
 * Settings in two tabs:
 * - General: Gemini AI (shared by every AI feature) · Speech & voice ·
 *   Share voice to Chrome · Appearance · Language · About.
 * - OCR: OCR language · Floating button · Auto-scroll reading · Speak with
 *   pagination · Refine text · Translation · Clipboard & history.
 * - File Management: open File Management · the shared Google Drive
 *   (client, refresh token, folder) File Share uses without an account.
 * The large groups are an accordion — one open at a time, each collapsed to
 * a one-line summary of its current state — so everything fits without long
 * scrolling.
 * Every control writes through the capture settings store, which persists
 * immediately and is mirrored to the native service.
 */
export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, preset, typographyPreset } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'Settings'>>();
  const { settings, update } = useCaptureSettings();
  const overlay = useOverlayController();
  const [toast, setToast] = useState<Toast>(null);
  const [open, setOpen] = useState<SectionKey | null>(null);
  const [tab, setTab] = useState<SettingsTab>(params?.tab ?? 'general');
  // Opened again with a tab (e.g. from File Management): switch to it.
  useEffect(() => {
    if (params?.tab) setTab(params.tab);
  }, [params?.tab]);
  const chooseTab = (next: SettingsTab) => {
    setTab(next);
    setOpen(null);
  };
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
      <SettingsTabs
        value={tab}
        onChange={chooseTab}
        accessibilityLabel={t('settings.tabsLabel')}
        tabs={[
          { value: 'general', label: t('settings.tabGeneral') },
          { value: 'ocr', label: t('settings.tabOcr') },
          { value: 'files', label: t('settings.tabFiles') },
        ]}
      />
      <ScrollView
        key={tab}
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

        {tab === 'ocr' ? (
          <>
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

            <ReadingSection {...section('reading')} />

            <PaginationSection {...section('pagination')} />

            <RefineSection {...section('refine')} />

            <TranslateSection {...section('translate')} />

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
          </>
        ) : tab === 'files' ? (
          <>
            <SettingsSection title={t('settings.tabFiles')}>
              <ListRow
                icon="folder"
                title={t('driveCreds.openFiles')}
                subtitle={t('driveCreds.openFilesHint')}
                onPress={() => navigation.navigate(ROUTES.FILE_MANAGEMENT)}
                testID="settings-open-files"
              />
            </SettingsSection>

            <DriveCredentialsSection {...section('driveCreds')} />
          </>
        ) : (
          <>
            <GeminiSection {...section('gemini')} />

            <SpeechSection {...section('speech')} />

            <AudioShareSection {...section('audioShare')} />

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
                  <Text
                    style={[typography.body, { color: colors.textSecondary }]}
                  >
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
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
