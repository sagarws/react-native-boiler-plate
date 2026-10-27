import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TRANSLATE_PROMPT,
  MAX_TRANSLATE_PROMPT,
  SPEECH_LANGUAGES,
  useCaptureSettings,
  useGeminiKey,
  useSpeechInfo,
  type SpeechLanguage,
} from '@/features/capture';
import {
  Button,
  ExpandableCard,
  ListRow,
  Notice,
  SegmentedControl,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch } from './SettingControls';

export interface TranslateSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Translation: the "Apply translation" switch (also the consent to send
 * extracted text to Gemini), languages and instructions. The API key, model
 * and thinking level are shared AI settings in General → Gemini AI.
 */
export function TranslateSection({
  expanded,
  onToggle,
}: TranslateSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const { settings, updateTranslate } = useCaptureSettings();
  const tr = settings.translate;
  const key = useGeminiKey();
  const { info } = useSpeechInfo(settings.speech.preferGoogle);
  const langName = (l: SpeechLanguage) => t(`speech.lang_${l}_name`);
  const targetName = langName(tr.target);
  const summary = !tr.enabled
    ? t('translate.summaryOff')
    : key.status.hasKey
    ? t('translate.summaryReady', { target: targetName })
    : t('translate.summaryNoKey', { target: targetName });
  const voiceMissing =
    info?.ready === true && info.languages[tr.target] !== 'available';

  const inputStyle = [
    typography.body,
    styles.input,
    {
      color: colors.textPrimary,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      padding: spacing.md,
    },
  ];
  const block = [
    styles.block,
    { padding: spacing.lg, gap: spacing.sm, borderTopColor: colors.divider },
  ];
  const label = [typography.label, { color: colors.textPrimary }];
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <ExpandableCard
      title={t('translate.section')}
      summary={summary}
      icon="languages"
      expanded={expanded}
      onToggle={onToggle}
      testID="settings-translate"
    >
      <ListRow
        icon="languages"
        title={t('translate.apply')}
        subtitle={t('translate.applyHint')}
        right={
          <SettingSwitch
            testID="translate-enabled"
            value={tr.enabled}
            onChange={enabled => updateTranslate({ enabled })}
            label={t('translate.apply')}
          />
        }
      />
      <View
        style={{
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <Text style={caption}>{t('translate.privacy')}</Text>
        {tr.enabled && !key.status.hasKey ? (
          <Notice
            testID="translate-needs-key"
            tone="warning"
            message={t('translate.needsKey')}
          />
        ) : null}
      </View>

      <View style={block}>
        <Text style={label}>{t('translate.target')}</Text>
        <SegmentedControl
          testID="translate-target"
          accessibilityLabel={t('translate.target')}
          value={tr.target}
          onChange={target => updateTranslate({ target })}
          options={SPEECH_LANGUAGES.map(l => ({
            value: l,
            label: t(`speech.lang_${l}`),
          }))}
        />
        {voiceMissing ? (
          <Notice
            testID="translate-voice-missing"
            tone="warning"
            message={t('translate.voiceMissing', { language: targetName })}
          />
        ) : null}
        <Text style={[label, { marginTop: spacing.sm }]}>
          {t('translate.source')}
        </Text>
        <SegmentedControl
          testID="translate-source"
          accessibilityLabel={t('translate.source')}
          value={tr.source}
          onChange={source => updateTranslate({ source })}
          options={[
            { value: 'auto' as const, label: t('translate.source_auto') },
            ...SPEECH_LANGUAGES.map(l => ({
              value: l,
              label: t(`speech.lang_${l}`),
            })),
          ]}
        />
      </View>

      <View style={block}>
        <Text style={label}>{t('translate.prompt')}</Text>
        <TextInput
          testID="translate-prompt"
          accessibilityLabel={t('translate.prompt')}
          value={tr.prompt}
          onChangeText={prompt =>
            updateTranslate({ prompt: prompt.slice(0, MAX_TRANSLATE_PROMPT) })
          }
          multiline
          maxLength={MAX_TRANSLATE_PROMPT}
          textAlignVertical="top"
          style={[inputStyle, styles.prompt]}
        />
        <View style={styles.row}>
          <Text style={[caption, styles.flex]}>
            {t('translate.promptHint', {
              count: tr.prompt.length,
              max: MAX_TRANSLATE_PROMPT,
            })}
          </Text>
          <Button
            size="sm"
            variant="ghost"
            label={t('translate.resetPrompt')}
            onPress={() =>
              updateTranslate({ prompt: DEFAULT_TRANSLATE_PROMPT })
            }
            disabled={tr.prompt === DEFAULT_TRANSLATE_PROMPT}
            style={styles.inline}
            testID="translate-reset-prompt"
          />
        </View>
      </View>
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  block: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  inline: { alignSelf: 'auto' },
  input: { borderWidth: 1, minHeight: 48 },
  prompt: { minHeight: 110 },
});
