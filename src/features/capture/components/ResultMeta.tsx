import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/shared/components';
import { useTheme } from '@/theme';
import { formatAgo } from '../utils/relativeTime';
import { countLines } from '../utils/text';
import type { OcrResult } from '../capture.types';

export interface ResultMetaProps {
  result: OcrResult;
  text: string;
}

/** Language, age, size and recognition time of one extraction. */
export function ResultMeta({ result, text }: ResultMetaProps) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const details = [
    formatAgo(t, result.createdAt),
    t('extracted.lines', { count: countLines(text) }),
    t('extracted.took', { seconds: (result.durationMs / 1000).toFixed(1) }),
  ].join(' · ');

  return (
    <View style={[styles.row, { gap: spacing.sm }]}>
      <StatusPill
        label={t(`ocrMode.${result.mode}`)}
        tone="primary"
        testID="result-mode"
      />
      <Text
        style={[
          typography.caption,
          styles.details,
          { color: colors.textSecondary },
        ]}
        numberOfLines={1}
      >
        {details}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  details: { flex: 1 },
});
