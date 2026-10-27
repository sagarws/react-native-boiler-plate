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
  THINKING_LEVELS,
  looksLikeApiKey,
  useCaptureSettings,
  useGeminiKey,
  useSpeechInfo,
  type GeminiReport,
  type SpeechLanguage,
} from '@/features/capture';
import {
  Button,
  ChoiceList,
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

/** The project this app's translation key is meant to belong to (pre-filled, editable). */
const SUGGESTED_PROJECT = '49677894119';

/**
 * Translation: the "Apply translation" switch (also the consent to send
 * extracted text to Gemini), languages, instructions, model + thinking level,
 * the API key (write-only from JS), project number and a connection test
 * that reports Google's own error text.
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
  const [report, setReport] = useState<GeminiReport | null>(null);
  const [projectInput, setProjectInput] = useState(
    tr.projectNumber || SUGGESTED_PROJECT,
  );
  const [projectMessage, setProjectMessage] = useState<
    'projectSaved' | 'projectInvalid' | null
  >(null);

  const langName = (l: SpeechLanguage) => t(`speech.lang_${l}_name`);
  const targetName = langName(tr.target);
  const summary = !tr.enabled
    ? t('translate.summaryOff')
    : key.status.hasKey
    ? t('translate.summaryReady', { target: targetName })
    : t('translate.summaryNoKey', { target: targetName });
  const voiceMissing =
    info?.ready === true && info.languages[tr.target] !== 'available';

  const onSaveKey = useCallback(async () => {
    setReport(null);
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
            setReport(null);
          },
        },
      ],
    );
  }, [key, t]);

  const onTest = useCallback(async () => {
    setReport(await key.test());
  }, [key]);

  const onSaveProject = useCallback(() => {
    const value = projectInput.trim();
    if (!/^\d{6,20}$/.test(value)) {
      setProjectMessage('projectInvalid');
      return;
    }
    updateTranslate({ projectNumber: value });
    setProjectMessage('projectSaved');
  }, [projectInput, updateTranslate]);

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
      footer={t('translate.security')}
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
            message={t('translate.summaryNoKey', { target: targetName })}
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

      <View style={block}>
        <View style={styles.row}>
          <Text style={[label, styles.flex]}>{t('translate.apiKey')}</Text>
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
        <Text style={caption}>{t('translate.apiKeyHint')}</Text>
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
        {report ? (
          <Notice
            testID="translate-test-result"
            tone={report.outcome === 'ok' ? 'success' : 'warning'}
            message={[
              t(`translate.test_${report.outcome}`),
              report.detail
                ? t('translate.testDetail', {
                    status: report.status,
                    detail: report.detail,
                  })
                : null,
            ]
              .filter(Boolean)
              .join('\n')}
          />
        ) : null}
      </View>

      <View style={block}>
        <Text style={label}>{t('translate.model')}</Text>
        <TextInput
          testID="translate-model"
          accessibilityLabel={t('translate.model')}
          value={tr.model}
          onChangeText={model => updateTranslate({ model })}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
        />
        <Text style={caption}>
          {t('translate.modelHint', { model: DEFAULT_TRANSLATE_MODEL })}
        </Text>
        <Text style={[label, { marginTop: spacing.sm }]}>
          {t('translate.modelsTitle')}
        </Text>
        {key.models.length > 0 ? (
          <ChoiceList
            testID="translate-models"
            accessibilityLabel={t('translate.modelsTitle')}
            value={tr.model}
            onChange={model => updateTranslate({ model })}
            choices={key.models.slice(0, 12).map(m => ({
              value: m.id,
              title: m.displayName,
              description: m.id,
            }))}
          />
        ) : (
          <Text style={caption}>{t('translate.modelsHint')}</Text>
        )}
        <Text style={[label, { marginTop: spacing.sm }]}>
          {t('translate.thinking')}
        </Text>
        <SegmentedControl
          testID="translate-thinking"
          accessibilityLabel={t('translate.thinking')}
          value={tr.thinkingLevel}
          onChange={thinkingLevel => updateTranslate({ thinkingLevel })}
          options={THINKING_LEVELS.map(level => ({
            value: level,
            label: t(`translate.thinking_${level}`),
          }))}
        />
        <Text style={caption}>{t('translate.thinkingHint')}</Text>
      </View>

      <View style={block}>
        <Text style={label}>{t('translate.project')}</Text>
        <TextInput
          testID="translate-project"
          accessibilityLabel={t('translate.project')}
          value={projectInput}
          onChangeText={value => {
            setProjectInput(value.replace(/[^0-9]/g, ''));
            setProjectMessage(null);
          }}
          placeholder={t('translate.projectPlaceholder')}
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          style={inputStyle}
        />
        <Button
          size="sm"
          variant="soft"
          label={t('translate.projectSave')}
          onPress={onSaveProject}
          testID="translate-project-save"
        />
        {projectMessage ? (
          <Notice
            testID="translate-project-message"
            tone={projectMessage === 'projectSaved' ? 'success' : 'error'}
            message={t(`translate.${projectMessage}`, {
              project: tr.projectNumber,
            })}
          />
        ) : null}
        <Text style={caption}>
          {t('translate.projectHint', {
            project: tr.projectNumber || projectInput || SUGGESTED_PROJECT,
          })}
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
