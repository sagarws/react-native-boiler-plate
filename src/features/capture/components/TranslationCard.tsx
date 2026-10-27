import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/shared/components';
import { useTheme } from '@/theme';
import { isSpeechLanguage, type OcrResult } from '../capture.types';

export interface TranslationCardProps {
  result: OcrResult;
  onCopy: (text: string) => void;
}

/** The Gemini translation of a capture, shown above the original text. */
export function TranslationCard({ result, onCopy }: TranslationCardProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  if (!result.translation) return null;
  const target = result.targetLanguage;
  const language = isSpeechLanguage(target)
    ? t(`speech.lang_${target}_name`)
    : target ?? '';

  return (
    <Card testID="translation-card" style={{ gap: spacing.sm }}>
      <View style={styles.row}>
        <Text
          style={[
            typography.overline,
            styles.flex,
            { color: colors.primaryText },
          ]}
        >
          {t('translate.translationLabel', { language })}
        </Text>
        <Button
          size="sm"
          variant="soft"
          iconName="copy"
          label={t('translate.copyTranslation')}
          onPress={() => onCopy(result.translation ?? '')}
          style={styles.inline}
          testID="translation-copy"
        />
      </View>
      <ScrollView style={styles.text} nestedScrollEnabled>
        <Text
          selectable
          style={[typography.reading, { color: colors.textPrimary }]}
        >
          {result.translation}
        </Text>
      </ScrollView>
      <Text style={[typography.overline, { color: colors.textSecondary }]}>
        {t('translate.originalLabel')}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  inline: { alignSelf: 'auto' },
  text: { maxHeight: 220 },
});
