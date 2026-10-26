import React, { useCallback, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FEATURES } from '@/config';
import {
  BUBBLE_OPACITY,
  BUBBLE_SIZE,
  clearAllCaptures,
  OcrModePicker,
  OverlayNoticeBanner,
  screenOcrService,
  useCaptureSettings,
  useOverlayController,
} from '@/features/capture';
import { signOut } from '@/features/session';
import { setLanguage } from '@/i18n';
import { isSupportedLanguage, type LanguageCode } from '@/i18n/languages';
import { ROUTES } from '@/navigation/routes';
import {
  Button,
  Header,
  LanguageDropdown,
  ListRow,
  Notice,
  Slider,
  StatusPill,
} from '@/shared/components';
import { appVersion } from '@/shared/utils';
import { useTheme } from '@/theme';
import { SettingsSection } from '../components/SettingsSection';

type Toast = 'historyCleared' | 'resetPositionDone' | null;

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, preset, typographyPreset } = useTheme();
  const navigation = useNavigation();
  const { settings, update } = useCaptureSettings();
  const overlay = useOverlayController();
  const [toast, setToast] = useState<Toast>(null);

  const language: LanguageCode = isSupportedLanguage(i18n.language)
    ? i18n.language
    : 'en';
  const switchColors = { false: colors.disabled, true: colors.primary };

  const onToggleOverlay = useCallback(
    (on: boolean) => {
      if (!on) overlay.disable();
      else if (!overlay.status.overlayPermission) overlay.openOverlaySettings();
      else void overlay.enable();
    },
    [overlay],
  );

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

  const onResetPosition = useCallback(() => {
    screenOcrService.resetBubblePosition();
    setToast('resetPositionDone');
  }, []);

  const onSignOut = useCallback(() => {
    Alert.alert(t('settings.signOut'), t('settings.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.signOut'), style: 'destructive', onPress: signOut },
    ]);
  }, [t]);

  const switchFor = (
    value: boolean,
    onChange: (v: boolean) => void,
    label: string,
    testID: string,
  ) => (
    <Switch
      testID={testID}
      value={value}
      onValueChange={onChange}
      accessibilityLabel={label}
      trackColor={switchColors}
      thumbColor={colors.surface}
    />
  );

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
          gap: spacing.xl,
        }}
      >
        {toast ? (
          <Notice
            tone="success"
            message={t(`settings.${toast}`)}
            onDismiss={() => setToast(null)}
          />
        ) : null}

        <SettingsSection
          title={t('settings.sectionOcr')}
          footer={t('settings.ocrHint')}
          padded
          testID="settings-ocr"
        >
          <OcrModePicker
            value={settings.ocrMode}
            onChange={ocrMode => update({ ocrMode })}
          />
        </SettingsSection>

        <View style={{ gap: spacing.sm }}>
          <OverlayNoticeBanner controller={overlay} />
          <SettingsSection
            title={t('settings.sectionFloating')}
            footer={t('settings.floatingRestrictions')}
            testID="settings-floating"
          >
            <ListRow
              icon="scanText"
              title={t('settings.floatingEnabled')}
              subtitle={t('settings.floatingEnabledHint')}
              disabled={!overlay.status.supported || overlay.busy}
              right={switchFor(
                overlay.status.serviceRunning,
                onToggleOverlay,
                t('settings.floatingEnabled'),
                'settings-overlay-switch',
              )}
            />
            <ListRow
              divider
              icon="layers"
              title={t('settings.overlayPermission')}
              right={
                overlay.status.overlayPermission ? (
                  <StatusPill label={t('settings.granted')} tone="success" />
                ) : (
                  <Button
                    size="sm"
                    variant="soft"
                    label={t('settings.grant')}
                    onPress={overlay.openOverlaySettings}
                    style={styles.inlineButton}
                  />
                )
              }
            />
            <View
              style={[
                styles.sliderRow,
                { padding: spacing.lg, borderTopColor: colors.divider },
              ]}
            >
              <View style={styles.sliderLabel}>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {t('settings.bubbleSize')}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('settings.bubbleSizeValue', {
                    value: settings.bubbleSizeDp,
                  })}
                </Text>
              </View>
              <Slider
                testID="settings-bubble-size"
                value={settings.bubbleSizeDp}
                min={BUBBLE_SIZE.min}
                max={BUBBLE_SIZE.max}
                step={BUBBLE_SIZE.step}
                onChange={bubbleSizeDp => update({ bubbleSizeDp })}
                accessibilityLabel={t('settings.bubbleSize')}
                accessibilityValueText={t('settings.bubbleSizeValue', {
                  value: settings.bubbleSizeDp,
                })}
              />
            </View>
            <View
              style={[
                styles.sliderRow,
                { padding: spacing.lg, borderTopColor: colors.divider },
              ]}
            >
              <View style={styles.sliderLabel}>
                <Text style={[typography.label, { color: colors.textPrimary }]}>
                  {t('settings.bubbleOpacity')}
                </Text>
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('settings.bubbleOpacityValue', {
                    value: Math.round(settings.bubbleOpacity * 100),
                  })}
                </Text>
              </View>
              <Slider
                testID="settings-bubble-opacity"
                value={Math.round(settings.bubbleOpacity * 100)}
                min={BUBBLE_OPACITY.min * 100}
                max={BUBBLE_OPACITY.max * 100}
                step={BUBBLE_OPACITY.step * 100}
                onChange={percent => update({ bubbleOpacity: percent / 100 })}
                accessibilityLabel={t('settings.bubbleOpacity')}
                accessibilityValueText={t('settings.bubbleOpacityValue', {
                  value: Math.round(settings.bubbleOpacity * 100),
                })}
              />
            </View>
            <ListRow
              divider
              icon="rotateCcw"
              title={t('settings.resetPosition')}
              onPress={onResetPosition}
              testID="settings-reset-position"
            />
          </SettingsSection>
        </View>

        <SettingsSection
          title={t('settings.sectionClipboard')}
          footer={t('settings.privacyNote')}
          testID="settings-clipboard"
        >
          <ListRow
            icon="clipboardCheck"
            title={t('settings.autoCopy')}
            subtitle={t('settings.autoCopyHint')}
            right={switchFor(
              settings.autoCopy,
              autoCopy => update({ autoCopy }),
              t('settings.autoCopy'),
              'settings-auto-copy',
            )}
          />
          <ListRow
            divider
            icon="history"
            title={t('settings.saveHistory')}
            subtitle={t('settings.saveHistoryHint')}
            right={switchFor(
              settings.saveHistory,
              saveHistory => update({ saveHistory }),
              t('settings.saveHistory'),
              'settings-save-history',
            )}
          />
          <ListRow
            divider
            destructive
            icon="trash2"
            title={t('settings.clearHistory')}
            onPress={onClearHistory}
            testID="settings-clear-history"
          />
        </SettingsSection>

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
  inlineButton: { alignSelf: 'auto' },
  sliderRow: { borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  sliderLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
