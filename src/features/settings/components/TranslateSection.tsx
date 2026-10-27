import React, { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_TRANSLATE_MODEL,
  DEFAULT_TRANSLATE_PROMPT,
  MAX_TRANSLATE_PROMPT,
  SPEECH_LANGUAGES,
  looksLikeApiKey,
  useCaptureSettings,
  useGeminiKey,
  useSpeechInfo,
  type GeminiTestOutcome,
  type SpeechLanguage,
} from '@/features/capture';
import {
  Button,
  ExpandableCard,
  Icon,
  ListRow,
  Notice,
  SegmentedControl,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch } from './SettingControls';

export interface TranslateSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

type KeyMessage = 'keySaveFailed' | 'keyTooShort' | null;

/**
 * Translate & speak: opt-in consent, target/source language, translation
 * instructions, the Gemini API key (write-only from JS) and a connection
 * test. Nothing is sent anywhere until consent is on and a key is saved.
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
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<KeyMessage>(null);
  const [testResult, setTestResult] = useState<GeminiTestOutcome | null>(null);

  const langName = (l: SpeechLanguage) => t(`speech.lang_${l}_name`);
  const targetName = langName(tr.target);
  const summary = !tr.consent
    ? t('translate.summaryNoConsent')
    : key.status.hasKey
    ? t('translate.summaryReady', { target: targetName })
    : t('translate.summaryNoKey', { target: targetName });
  const voiceMissing =
    info?.ready === true && info.languages[tr.target] !== 'available';

  const onSaveKey = useCallback(async () => {
    setTestResult(null);
    if (!looksLikeApiKey(keyInput)) {
      setKeyMessage('keyTooShort');
      return;
    }
    const ok = await key.save(keyInput);
    // The key leaves JS state as soon as it has been handed to native storage.
    setKeyInput('');
    setShowKey(false);
    setKeyMessage(ok ? null : 'keySaveFailed');
  }, [key, keyInput]);

  const onRemoveKey = useCallback(() => {
    Alert.alert(
      t('translate.removeKeyConfirmTitle'),
      t('translate.removeKeyConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('translate.removeKey'),
          style: 'destructive',
          onPress: () => {
            key.remove();
            setTestResult(null);
          },
        },
      ],
    );
  }, [key, t]);

  const onTest = useCallback(async () => {
    setTestResult(await key.test());
  }, [key]);

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

  return (
    <ExpandableCard
      title={t('translate.section')}
      summary={summary}
      icon="languages"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('translate.security')}
      testID="settings-translate"
    >
      <View style={{ padding: spacing.lg, gap: spacing.sm }}>
        <Text style={[typography.body, { color: colors.textSecondary }]}>
          {t('translate.intro')}
        </Text>
      </View>

      <ListRow
        divider
        icon="shieldCheck"
        title={t('translate.consent')}
        subtitle={t('translate.consentHint')}
        right={
          <SettingSwitch
            testID="translate-consent"
            value={tr.consent}
            onChange={consent => updateTranslate({ consent })}
            label={t('translate.consent')}
          />
        }
      />
      <View
        style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
      >
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('translate.privacy')}
        </Text>
      </View>

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
          {t('translate.target')}
        </Text>
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
        <Text
          style={[
            typography.label,
            { color: colors.textPrimary, marginTop: spacing.sm },
          ]}
        >
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
          {t('translate.prompt')}
        </Text>
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
          placeholderTextColor={colors.placeholder}
          style={[inputStyle, styles.prompt]}
        />
        <View style={styles.row}>
          <Text
            style={[
              typography.caption,
              styles.flex,
              { color: colors.textSecondary },
            ]}
          >
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
        <View style={styles.row}>
          <Text
            style={[
              typography.label,
              styles.flex,
              { color: colors.textPrimary },
            ]}
          >
            {t('translate.apiKey')}
          </Text>
          <StatusPill
            testID="translate-key-status"
            label={
              key.status.hasKey
                ? t('translate.keySaved', { hint: key.status.hint })
                : t('translate.keyNotSaved')
            }
            tone={key.status.hasKey ? 'success' : 'neutral'}
          />
        </View>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('translate.apiKeyHint')}
        </Text>
        <View style={styles.row}>
          <TextInput
            testID="translate-key-input"
            accessibilityLabel={t('translate.apiKey')}
            value={keyInput}
            onChangeText={value => {
              setKeyInput(value);
              setKeyMessage(null);
            }}
            placeholder={t('translate.keyPlaceholder')}
            placeholderTextColor={colors.placeholder}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            importantForAutofill="no"
            style={[inputStyle, styles.flex]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showKey ? t('translate.hideKey') : t('translate.showKey')
            }
            onPress={() => setShowKey(v => !v)}
            style={styles.eye}
          >
            <Icon
              name="eye"
              size={20}
              color={showKey ? colors.primaryText : colors.textSecondary}
            />
          </Pressable>
        </View>
        {keyMessage ? (
          <Notice
            testID="translate-key-message"
            tone="error"
            message={t(`translate.${keyMessage}`)}
          />
        ) : null}
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            size="sm"
            label={t('translate.saveKey')}
            iconName="lock"
            onPress={() => {
              void onSaveKey();
            }}
            disabled={keyInput.trim().length === 0}
            style={styles.flex}
            testID="translate-save-key"
          />
          {key.status.hasKey ? (
            <Button
              size="sm"
              variant="secondary"
              label={t('translate.removeKey')}
              iconName="trash2"
              onPress={onRemoveKey}
              style={styles.flex}
              testID="translate-remove-key"
            />
          ) : null}
        </View>
        <Button
          size="sm"
          variant="soft"
          iconName="circleCheck"
          label={key.testing ? t('translate.testing') : t('translate.test')}
          loading={key.testing}
          onPress={() => {
            void onTest();
          }}
          disabled={!key.status.hasKey}
          testID="translate-test"
        />
        {testResult ? (
          <Notice
            testID="translate-test-result"
            tone={testResult === 'ok' ? 'success' : 'warning'}
            message={t(`translate.test_${testResult}`)}
          />
        ) : null}
      </View>

      <View
        style={[
          styles.block,
          {
            padding: spacing.lg,
            gap: spacing.xs,
            borderTopColor: colors.divider,
          },
        ]}
      >
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('translate.model')}
        </Text>
        <TextInput
          testID="translate-model"
          accessibilityLabel={t('translate.model')}
          value={tr.model}
          onChangeText={model => updateTranslate({ model })}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
        />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>
          {t('translate.modelHint', { model: DEFAULT_TRANSLATE_MODEL })}
        </Text>
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
  eye: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
