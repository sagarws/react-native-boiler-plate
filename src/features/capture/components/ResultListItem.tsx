import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import { formatAgo } from '../utils/relativeTime';
import { previewText } from '../utils/text';
import type { OcrResult } from '../capture.types';

export interface ResultListItemProps {
  result: OcrResult;
  onPress: (result: OcrResult) => void;
  divider?: boolean;
}

/** A saved extraction in a list: two-line preview, language and age. */
export function ResultListItem({
  result,
  onPress,
  divider = false,
}: ResultListItemProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const preview = previewText(result.text);

  return (
    <Pressable
      testID={`result-${result.id}`}
      accessibilityRole="button"
      accessibilityLabel={t('home.openResult', {
        preview: previewText(result.text, 60),
      })}
      onPress={() => onPress(result)}
      android_ripple={{ color: colors.primarySoft }}
      style={({ pressed }) => [
        styles.row,
        { padding: spacing.lg, gap: spacing.md },
        divider && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.divider,
        },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: colors.primarySoft, borderRadius: radius.md },
        ]}
      >
        <Icon name="scanText" size={18} color={colors.primaryText} />
      </View>
      <View style={styles.body}>
        <Text
          numberOfLines={2}
          style={[typography.body, { color: colors.textPrimary }]}
        >
          {preview}
        </Text>
        <Text
          style={[
            typography.caption,
            { color: colors.textSecondary, marginTop: spacing.xs },
          ]}
        >
          {t(`ocrMode.${result.mode}`)} · {formatAgo(t, result.createdAt)}
        </Text>
      </View>
      <Icon name="chevronRight" size={18} color={colors.placeholder} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
});
