import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_REFINE_PROMPT,
  MAX_TRANSLATE_PROMPT,
  useCaptureSettings,
  useGeminiKey,
} from '@/features/capture';
import { Button, ExpandableCard, ListRow, Notice } from '@/shared/components';
import { useTheme } from '@/theme';
import { SettingSwitch } from './SettingControls';

export interface RefineSectionProps {
  expanded: boolean;
  onToggle: () => void;
}

/**
 * Refine text: the switch (also the consent to send extracted text to
 * Gemini) and the repair instructions. Key, model and thinking level are
 * shared with the Translation card.
 */
export function RefineSection({ expanded, onToggle }: RefineSectionProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const { settings, updateRefine } = useCaptureSettings();
  const refine = settings.refine;
  const key = useGeminiKey();

  const summary = !refine.enabled
    ? t('refine.summaryOff')
    : key.status.hasKey
    ? t('refine.summaryReady')
    : t('refine.summaryNoKey');
  const caption = [typography.caption, { color: colors.textSecondary }];

  return (
    <ExpandableCard
      title={t('refine.section')}
      summary={summary}
      icon="sparkles"
      expanded={expanded}
      onToggle={onToggle}
      footer={t('refine.footer')}
      testID="settings-refine"
    >
      <ListRow
        icon="sparkles"
        title={t('refine.apply')}
        subtitle={t('refine.applyHint')}
        right={
          <SettingSwitch
            testID="refine-enabled"
            value={refine.enabled}
            onChange={enabled => updateRefine({ enabled })}
            label={t('refine.apply')}
          />
        }
      />
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
        <Text style={caption}>{t('refine.order')}</Text>
        {refine.enabled && !key.status.hasKey ? (
          <Notice
            testID="refine-needs-key"
            tone="warning"
            message={t('refine.needsKey')}
          />
        ) : null}
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('refine.prompt')}
        </Text>
        <TextInput
          testID="refine-prompt"
          accessibilityLabel={t('refine.prompt')}
          value={refine.prompt}
          onChangeText={prompt =>
            updateRefine({ prompt: prompt.slice(0, MAX_TRANSLATE_PROMPT) })
          }
          multiline
          maxLength={MAX_TRANSLATE_PROMPT}
          textAlignVertical="top"
          style={[
            typography.body,
            styles.prompt,
            {
              color: colors.textPrimary,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              padding: spacing.md,
            },
          ]}
        />
        <View style={styles.row}>
          <Text style={[caption, styles.flex]}>
            {t('refine.promptHint', {
              count: refine.prompt.length,
              max: MAX_TRANSLATE_PROMPT,
            })}
          </Text>
          <Button
            size="sm"
            variant="ghost"
            label={t('refine.resetPrompt')}
            onPress={() => updateRefine({ prompt: DEFAULT_REFINE_PROMPT })}
            disabled={refine.prompt === DEFAULT_REFINE_PROMPT}
            testID="refine-reset-prompt"
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
  prompt: { borderWidth: 1, minHeight: 140 },
});
