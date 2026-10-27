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
  THINKING_LEVELS,
  looksLikeApiKey,
  useCaptureSettings,
  useGeminiKey,
  type GeminiReport,
} from '@/features/capture';
import {
  Button,
  ChoiceList,
  ExpandableCard,
  Icon,
  Notice,
  SegmentedControl,
  StatusPill,
} from '@/shared/components';
import { useTheme } from '@/theme';

export interface GeminiSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

type KeyMessage = 'keySaveFailed' | 'keyTooShort' | null;

/** The project this app's key is meant to belong to (pre-filled, editable). */
const SUGGESTED_PROJECT = '49677894119';

/**
 * Gemini AI — the settings every AI feature shares (Refine text and
 * Translation today): the API key (write-only from JS, encrypted natively),
 * model, thinking level, project number, and a connection test that reports
 * Google's own error text. The values are stored with the translate settings
 * (`translate.model` etc.) because native reads them from there.
 */
export function GeminiSection({ expanded, onToggle }: GeminiSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const { settings, updateTranslate } = useCaptureSettings();
  const ai = settings.translate;
  const key = useGeminiKey();
  const [keyInput, setKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<KeyMessage>(null);
  const [report, setReport] = useState<GeminiReport | null>(null);
  const [projectInput, setProjectInput] = useState(
    ai.projectNumber || SUGGESTED_PROJECT,
  );
  const [projectMessage, setProjectMessage] = useState<
    'projectSaved' | 'projectInvalid' | null
  >(null);

  const summary = key.status.hasKey
    ? t('gemini.summaryReady', { hint: key.status.hint, model: ai.model })
    : t('gemini.summaryNoKey');

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
      t('gemini.removeKeyConfirmTitle'),
      t('gemini.removeKeyConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('gemini.removeKey'),
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
      title={t('gemini.section')}
      summary={summary}
      icon="sparkles"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('gemini.security')}
      testID="settings-gemini"
    >
      <View style={[styles.intro, { padding: spacing.lg, gap: spacing.xs }]}>
        <Text style={caption}>{t('gemini.intro')}</Text>
        <Text style={label}>{t('gemini.usedBy')}</Text>
      </View>

      <View style={block}>
        <View style={styles.row}>
          <Text style={[label, styles.flex]}>{t('gemini.apiKey')}</Text>
          <StatusPill
            testID="gemini-key-status"
            label={
              key.status.hasKey
                ? t('gemini.keySaved', { hint: key.status.hint })
                : t('gemini.keyNotSaved')
            }
            tone={key.status.hasKey ? 'success' : 'neutral'}
          />
        </View>
        <Text style={caption}>{t('gemini.apiKeyHint')}</Text>
        <View style={styles.row}>
          <TextInput
            testID="gemini-key-input"
            accessibilityLabel={t('gemini.apiKey')}
            value={keyInput}
            onChangeText={value => {
              setKeyInput(value);
              setKeyMessage(null);
            }}
            placeholder={t('gemini.keyPlaceholder')}
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
              showKey ? t('gemini.hideKey') : t('gemini.showKey')
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
            testID="gemini-key-message"
            tone="error"
            message={t(`gemini.${keyMessage}`)}
          />
        ) : null}
        <View style={[styles.row, { gap: spacing.sm }]}>
          <Button
            size="sm"
            label={t('gemini.saveKey')}
            iconName="lock"
            onPress={() => {
              void onSaveKey();
            }}
            disabled={keyInput.trim().length === 0}
            style={styles.flex}
            testID="gemini-save-key"
          />
          {key.status.hasKey ? (
            <Button
              size="sm"
              variant="secondary"
              label={t('gemini.removeKey')}
              iconName="trash2"
              onPress={onRemoveKey}
              style={styles.flex}
              testID="gemini-remove-key"
            />
          ) : null}
        </View>
        <Button
          size="sm"
          variant="soft"
          iconName="circleCheck"
          label={key.testing ? t('gemini.testing') : t('gemini.test')}
          loading={key.testing}
          onPress={() => {
            void onTest();
          }}
          disabled={!key.status.hasKey}
          testID="gemini-test"
        />
        {report ? (
          <Notice
            testID="gemini-test-result"
            tone={report.outcome === 'ok' ? 'success' : 'warning'}
            message={[
              t(`gemini.test_${report.outcome}`),
              report.detail
                ? t('gemini.testDetail', {
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
        <Text style={label}>{t('gemini.model')}</Text>
        <TextInput
          testID="gemini-model"
          accessibilityLabel={t('gemini.model')}
          value={ai.model}
          onChangeText={model => updateTranslate({ model })}
          autoCapitalize="none"
          autoCorrect={false}
          style={inputStyle}
        />
        <Text style={caption}>
          {t('gemini.modelHint', { model: DEFAULT_TRANSLATE_MODEL })}
        </Text>
        <Text style={[label, { marginTop: spacing.sm }]}>
          {t('gemini.modelsTitle')}
        </Text>
        {key.models.length > 0 ? (
          <ChoiceList
            testID="gemini-models"
            accessibilityLabel={t('gemini.modelsTitle')}
            value={ai.model}
            onChange={model => updateTranslate({ model })}
            choices={key.models.slice(0, 12).map(m => ({
              value: m.id,
              title: m.displayName,
              description: m.id,
            }))}
          />
        ) : (
          <Text style={caption}>{t('gemini.modelsHint')}</Text>
        )}
        <Text style={[label, { marginTop: spacing.sm }]}>
          {t('gemini.thinking')}
        </Text>
        <SegmentedControl
          testID="gemini-thinking"
          accessibilityLabel={t('gemini.thinking')}
          value={ai.thinkingLevel}
          onChange={thinkingLevel => updateTranslate({ thinkingLevel })}
          options={THINKING_LEVELS.map(level => ({
            value: level,
            label: t(`gemini.thinking_${level}`),
          }))}
        />
        <Text style={caption}>{t('gemini.thinkingHint')}</Text>
      </View>

      <View style={block}>
        <Text style={label}>{t('gemini.project')}</Text>
        <TextInput
          testID="gemini-project"
          accessibilityLabel={t('gemini.project')}
          value={projectInput}
          onChangeText={value => {
            setProjectInput(value.replace(/[^0-9]/g, ''));
            setProjectMessage(null);
          }}
          placeholder={t('gemini.projectPlaceholder')}
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          style={inputStyle}
        />
        <Button
          size="sm"
          variant="soft"
          label={t('gemini.projectSave')}
          onPress={onSaveProject}
          testID="gemini-project-save"
        />
        {projectMessage ? (
          <Notice
            testID="gemini-project-message"
            tone={projectMessage === 'projectSaved' ? 'success' : 'error'}
            message={t(`gemini.${projectMessage}`, {
              project: ai.projectNumber,
            })}
          />
        ) : null}
        <Text style={caption}>
          {t('gemini.projectHint', {
            project: ai.projectNumber || projectInput || SUGGESTED_PROJECT,
          })}
        </Text>
      </View>
    </ExpandableCard>
  );
}

const styles = StyleSheet.create({
  intro: {},
  block: { borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  input: { borderWidth: 1, minHeight: 48 },
  eye: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
