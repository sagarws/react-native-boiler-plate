import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  engineLabel,
  OCR_MODE_SCRIPTS,
  SPEECH_LANGUAGES,
  SPEECH_PITCH,
  SPEECH_RATE,
  speechService,
  unspeakableScripts,
  useCaptureSettings,
  useSpeechInfo,
  type SpeechInfo,
  type SpeechLanguage,
  type SpeechOutcome,
} from '@/features/capture';
import {
  Button,
  Card,
  ChoiceList,
  ListRow,
  Notice,
  SegmentedControl,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingsSection } from './SettingsSection';
import { SettingSwitch, SliderRow } from './SettingControls';

const DEFAULT_VOICE = '';

function EngineCard({
  info,
  preferGoogle,
  onPreferGoogle,
}: {
  info: SpeechInfo;
  preferGoogle: boolean;
  onPreferGoogle: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const active =
    engineLabel(info, info.activeEngine) || t('speech.engineUnknown');
  const fallback =
    engineLabel(info, info.defaultEngine) || t('speech.engineUnknown');

  return (
    <>
      <ListRow
        icon="audioLines"
        title={t('speech.preferGoogle')}
        subtitle={t('speech.preferGoogleHint')}
        right={
          <SettingSwitch
            testID="speech-prefer-google"
            value={preferGoogle}
            onChange={onPreferGoogle}
            label={t('speech.preferGoogle')}
          />
        }
      />
      <View
        style={[
          styles.engine,
          {
            padding: spacing.lg,
            gap: spacing.xs,
            borderTopColor: colors.divider,
          },
        ]}
      >
        <View style={styles.engineRow}>
          <Text
            style={[
              typography.label,
              styles.flex,
              { color: colors.textPrimary },
            ]}
            testID="speech-active-engine"
          >
            {t('speech.activeEngine', { engine: active })}
          </Text>
          <StatusPill
            testID="speech-engine-status"
            label={
              info.ready ? t('speech.engineReady') : t('speech.engineNotReady')
            }
            tone={info.ready ? 'success' : 'warning'}
          />
        </View>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('speech.defaultEngine', { engine: fallback })}
        </Text>
        {preferGoogle && !info.googleInstalled ? (
          <Text style={[typography.caption, { color: colors.warning }]}>
            {t('speech.googleMissing', { engine: fallback })}
          </Text>
        ) : null}
      </View>
      <View
        style={[
          styles.buttons,
          { padding: spacing.lg, paddingTop: 0, gap: spacing.sm },
        ]}
      >
        <Button
          size="sm"
          variant="soft"
          iconName="settings"
          label={t('speech.openTtsSettings')}
          onPress={speechService.openTtsSettings}
          style={styles.flex}
        />
        <Button
          size="sm"
          variant="soft"
          iconName="download"
          label={t('speech.installVoices')}
          onPress={speechService.installVoiceData}
          style={styles.flex}
          testID="speech-install-voices"
        />
      </View>
    </>
  );
}

/** Engine, speech language, voice, Test Voice, speed/pitch and behaviour toggles. */
export function SpeechSection() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { settings, updateSpeech } = useCaptureSettings();
  const speech = settings.speech;
  const { info, loading } = useSpeechInfo(speech.preferGoogle);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SpeechOutcome | null>(null);

  const language = speech.language;
  const status = info?.languages[language];
  const voices = (info?.voices ?? []).filter(v => v.language === language);
  const langName = (l: SpeechLanguage) => t(`speech.lang_${l}_name`);
  const missing = info
    ? unspeakableScripts(
        OCR_MODE_SCRIPTS[settings.ocrMode],
        info,
        language,
        speech.switchByScript,
      )
    : [];

  const onTest = useCallback(async () => {
    if (testing) {
      speechService.stop();
      setTesting(false);
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await speechService.testVoice(
      language,
      speech.voiceName,
      speech.rate,
      speech.pitch,
    );
    setTesting(false);
    setTestResult(result);
  }, [language, speech.pitch, speech.rate, speech.voiceName, testing]);

  const onLanguage = (next: SpeechLanguage) => {
    // A voice belongs to one language; switching resets to that language's default.
    updateSpeech({ language: next, voiceName: DEFAULT_VOICE });
    setTestResult(null);
  };

  return (
    <SettingsSection
      title={t('speech.section')}
      footer={t('speech.mixedNote')}
      testID="settings-speech"
    >
      {loading && !info ? (
        <View style={{ padding: spacing.lg }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : info && !info.supported ? (
        <View style={{ padding: spacing.lg }}>
          <Text style={[typography.body, { color: colors.textSecondary }]}>
            {t('speech.test_unsupported')}
          </Text>
        </View>
      ) : info ? (
        <>
          <EngineCard
            info={info}
            preferGoogle={speech.preferGoogle}
            onPreferGoogle={preferGoogle => updateSpeech({ preferGoogle })}
          />
          {!info.ready ? (
            <View
              style={{
                paddingHorizontal: spacing.lg,
                paddingBottom: spacing.lg,
              }}
            >
              <Notice tone="error" message={t('speech.engineFailed')} />
            </View>
          ) : null}

          <View
            style={[
              styles.block,
              {
                padding: spacing.lg,
                gap: spacing.sm,
                borderTopColor: colors.divider,
              },
            ]}
          >
            <Text style={[typography.label, { color: colors.textPrimary }]}>
              {t('speech.language')}
            </Text>
            <SegmentedControl
              testID="speech-language"
              accessibilityLabel={t('speech.language')}
              value={language}
              onChange={onLanguage}
              options={SPEECH_LANGUAGES.map(l => ({
                value: l,
                label: t(`speech.lang_${l}`),
              }))}
            />
            <View style={styles.engineRow}>
              <Text
                style={[
                  typography.caption,
                  styles.flex,
                  { color: colors.textSecondary },
                ]}
              >
                {t('speech.languageHint')}
              </Text>
              {status ? (
                <StatusPill
                  testID="speech-language-status"
                  label={t(`speech.status_${status}`)}
                  tone={status === 'available' ? 'success' : 'warning'}
                />
              ) : null}
            </View>
            {status && status !== 'available' ? (
              <Notice
                testID="speech-voice-missing"
                tone="warning"
                title={t('speech.voiceMissingTitle', {
                  language: langName(language),
                })}
                message={t('speech.voiceMissingBody', {
                  language: langName(language),
                })}
                action={{
                  label: t('speech.installVoices'),
                  onPress: speechService.installVoiceData,
                }}
              />
            ) : null}
            {missing.length > 0 ? (
              <Notice
                testID="speech-script-warning"
                tone="info"
                message={t('speech.scriptWarning', {
                  scripts: missing.map(langName).join(', '),
                })}
              />
            ) : null}
          </View>

          {status === 'available' ? (
            <View
              style={[
                styles.block,
                {
                  padding: spacing.lg,
                  gap: spacing.sm,
                  borderTopColor: colors.divider,
                },
              ]}
            >
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t('speech.voice')}
              </Text>
              <ChoiceList
                testID="speech-voice"
                accessibilityLabel={t('speech.voice')}
                value={
                  voices.some(v => v.name === speech.voiceName)
                    ? speech.voiceName
                    : DEFAULT_VOICE
                }
                onChange={voiceName => updateSpeech({ voiceName })}
                choices={[
                  {
                    value: DEFAULT_VOICE,
                    title: t('speech.defaultVoice'),
                    icon: 'sparkles' as const,
                  },
                  ...voices.map(v => ({
                    value: v.name,
                    title: v.name,
                    description: [
                      v.locale,
                      v.networkRequired
                        ? t('speech.voiceNetwork')
                        : t('speech.voiceOffline'),
                      v.installed ? null : t('speech.voiceNotInstalled'),
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  })),
                ]}
              />
              {voices.length === 0 ? (
                <Text
                  style={[typography.caption, { color: colors.textSecondary }]}
                >
                  {t('speech.noVoices')}
                </Text>
              ) : null}
            </View>
          ) : null}

          <Card flat style={styles.noBorder}>
            <SliderRow
              testID="speech-rate"
              label={t('speech.rate')}
              valueText={t('speech.rateValue', {
                value: speech.rate.toFixed(1),
              })}
              value={Math.round(speech.rate * 10)}
              min={SPEECH_RATE.min * 10}
              max={SPEECH_RATE.max * 10}
              step={SPEECH_RATE.step * 10}
              onChange={v => updateSpeech({ rate: v / 10 })}
            />
            <SliderRow
              testID="speech-pitch"
              label={t('speech.pitch')}
              valueText={t('speech.pitchValue', {
                value: speech.pitch.toFixed(1),
              })}
              value={Math.round(speech.pitch * 10)}
              min={SPEECH_PITCH.min * 10}
              max={SPEECH_PITCH.max * 10}
              step={SPEECH_PITCH.step * 10}
              onChange={v => updateSpeech({ pitch: v / 10 })}
            />
          </Card>

          <View
            style={{
              padding: spacing.lg,
              gap: spacing.sm,
              borderTopColor: colors.divider,
              borderTopWidth: StyleSheet.hairlineWidth,
            }}
          >
            <Button
              testID="speech-test"
              iconName={testing ? 'square' : 'play'}
              label={testing ? t('speech.stop') : t('speech.test')}
              onPress={() => void onTest()}
              disabled={!info.ready}
            />
            {testResult && testResult !== 'ok' ? (
              <Notice
                testID="speech-test-result"
                tone="warning"
                message={t(`speech.test_${testResult}`)}
              />
            ) : null}
          </View>

          <ListRow
            divider
            icon="languages"
            title={t('speech.switchByScript')}
            subtitle={t('speech.switchByScriptHint')}
            right={
              <SettingSwitch
                testID="speech-switch-by-script"
                value={speech.switchByScript}
                onChange={switchByScript => updateSpeech({ switchByScript })}
                label={t('speech.switchByScript')}
              />
            }
          />
          <ListRow
            divider
            icon="clipboardCheck"
            title={t('speech.copyBeforeSpeaking')}
            right={
              <SettingSwitch
                value={speech.copyBeforeSpeaking}
                onChange={copyBeforeSpeaking =>
                  updateSpeech({ copyBeforeSpeaking })
                }
                label={t('speech.copyBeforeSpeaking')}
              />
            }
          />
          <ListRow
            divider
            icon="square"
            title={t('speech.stopOnLeave')}
            subtitle={t('speech.stopOnLeaveHint')}
            right={
              <SettingSwitch
                value={speech.stopOnLeave}
                onChange={stopOnLeave => updateSpeech({ stopOnLeave })}
                label={t('speech.stopOnLeave')}
              />
            }
          />
          <ListRow
            divider
            icon="play"
            title={t('speech.resumeAfterInterruption')}
            subtitle={t('speech.resumeAfterInterruptionHint')}
            right={
              <SettingSwitch
                value={speech.resumeAfterInterruption}
                onChange={resumeAfterInterruption =>
                  updateSpeech({ resumeAfterInterruption })
                }
                label={t('speech.resumeAfterInterruption')}
              />
            }
          />
        </>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  engine: { borderTopWidth: StyleSheet.hairlineWidth },
  engineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { flexDirection: 'row' },
  block: { borderTopWidth: StyleSheet.hairlineWidth },
  noBorder: { borderWidth: 0, borderRadius: 0 },
});
