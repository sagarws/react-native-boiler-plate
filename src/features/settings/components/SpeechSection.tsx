import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  engineLabel,
  OCR_MODE_SCRIPTS,
  SPEECH_PITCH,
  SPEECH_RATE,
  savedVoiceStatus,
  speechService,
  unspeakableScripts,
  useCaptureSettings,
  useSpeechInfo,
  useVoicePreview,
  voicesFor,
  type SpeechInfo,
  type SpeechLanguage,
  type SpeechOutcome,
} from '@/features/capture';
import {
  Button,
  ExpandableCard,
  ListRow,
  Notice,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch, SliderRow } from './SettingControls';
import { TtsLanguageSection } from './TtsLanguageSection';

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

export interface SpeechSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Speech & voice: engine, language-first voice picker with per-voice
 * previews, Test Voice, speed/pitch and behaviour toggles. Collapses to a
 * one-line summary of the language and voice in use.
 */
export function SpeechSection({ expanded, onToggle }: SpeechSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { settings, updateSpeech } = useCaptureSettings();
  const speech = settings.speech;
  const { info, loading } = useSpeechInfo(speech.preferGoogle);
  const preview = useVoicePreview(speech.rate, speech.pitch);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SpeechOutcome | null>(null);

  const language = speech.language;
  const langName = (l: SpeechLanguage) => t(`speech.lang_${l}_name`);
  const voiceCount = voicesFor(info, language).length;
  const savedStatus = savedVoiceStatus(info, speech);
  const missing = info
    ? unspeakableScripts(
        OCR_MODE_SCRIPTS[settings.ocrMode],
        info,
        language,
        speech.switchByScript,
      )
    : [];

  const summary = t(info?.ready ? 'speech.summaryVoices' : 'speech.summary', {
    language: langName(language),
    voice: speech.voiceName || t('speech.defaultVoiceShort'),
    count: voiceCount,
  });

  // Collapsing the card ends any sample that is still playing.
  const { stop: stopPreview } = preview;
  useEffect(() => {
    if (!expanded) stopPreview();
  }, [expanded, stopPreview]);

  const onTest = useCallback(async () => {
    if (testing) {
      speechService.stop();
      setTesting(false);
      return;
    }
    stopPreview();
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
  }, [
    language,
    speech.pitch,
    speech.rate,
    speech.voiceName,
    stopPreview,
    testing,
  ]);

  const onSelect = useCallback(
    (nextLanguage: SpeechLanguage, voiceName: string) => {
      updateSpeech({ language: nextLanguage, voiceName });
      setTestResult(null);
    },
    [updateSpeech],
  );

  return (
    <ExpandableCard
      title={t('speech.section')}
      summary={summary}
      icon="volume2"
      expanded={expanded}
      onToggle={onToggle}
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
              {t('speech.voicesTitle')}
            </Text>
            <Text style={[typography.caption, { color: colors.textSecondary }]}>
              {t('speech.voicesHint')} {t('speech.languageHint')}
            </Text>
            {savedStatus === 'unavailable' ? (
              <Notice
                testID="speech-saved-voice-unavailable"
                tone="warning"
                message={t('speech.savedVoiceUnavailable', {
                  name: speech.voiceName,
                })}
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
            <TtsLanguageSection
              info={info}
              speech={speech}
              preview={preview}
              onSelect={onSelect}
            />
            <Button
              testID="speech-test"
              size="sm"
              iconName={testing ? 'square' : 'play'}
              label={testing ? t('speech.stop') : t('speech.test')}
              onPress={() => {
                void onTest();
              }}
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

          <View style={[styles.block, { borderTopColor: colors.divider }]}>
            <SliderRow
              divider={false}
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
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  engine: { borderTopWidth: StyleSheet.hairlineWidth },
  engineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttons: { flexDirection: 'row' },
  block: { borderTopWidth: StyleSheet.hairlineWidth },
});
