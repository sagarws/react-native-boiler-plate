import React, { memo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { VoiceInfo } from '@/features/capture';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';

export interface TtsVoiceRowProps {
  /** Null for the "default voice for this language" row (no preview). */
  voice: VoiceInfo | null;
  title: string;
  description: string;
  selected: boolean;
  playing: boolean;
  onSelect: () => void;
  onPreview?: () => void;
  testID: string;
}

/**
 * One voice: select area (radio, name, details) and, beside it — not inside
 * it — a Play/Stop preview button. Selecting never plays; playing never selects.
 */
export const TtsVoiceRow = memo(function TtsVoiceRow({
  voice,
  title,
  description,
  selected,
  playing,
  onSelect,
  onPreview,
  testID,
}: TtsVoiceRowProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          borderRadius: radius.lg,
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primarySoft : colors.surface,
        },
      ]}
    >
      <Pressable
        testID={testID}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected, selected }}
        accessibilityLabel={title}
        accessibilityHint={description}
        onPress={onSelect}
        style={[styles.select, { padding: spacing.md, gap: spacing.md }]}
      >
        <View
          style={[
            styles.radio,
            { borderColor: selected ? colors.primary : colors.placeholder },
            selected && { backgroundColor: colors.primary },
          ]}
        >
          {selected ? (
            <Icon name="check" size={12} color={colors.primaryForeground} />
          ) : null}
        </View>
        <View style={styles.text}>
          <Text
            numberOfLines={1}
            style={[typography.label, { color: colors.textPrimary }]}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={[typography.caption, { color: colors.textSecondary }]}
          >
            {description}
          </Text>
        </View>
      </Pressable>
      {voice && onPreview ? (
        <Pressable
          testID={`${testID}-play`}
          accessibilityRole="button"
          accessibilityLabel={
            playing
              ? t('speech.previewStop')
              : t('speech.previewPlay', { name: voice.name })
          }
          accessibilityState={{ busy: playing }}
          onPress={onPreview}
          hitSlop={4}
          style={({ pressed }) => [
            styles.play,
            {
              borderRadius: radius.pill,
              backgroundColor: playing
                ? colors.primary
                : pressed
                ? colors.secondary
                : colors.primarySoft,
              marginRight: spacing.sm,
            },
          ]}
        >
          {playing ? (
            <View style={styles.playing}>
              <ActivityIndicator
                size="small"
                color={colors.primaryForeground}
                style={styles.spinner}
              />
              <Icon name="square" size={14} color={colors.primaryForeground} />
            </View>
          ) : (
            <Icon name="play" size={18} color={colors.primaryText} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5 },
  select: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  play: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playing: { alignItems: 'center', justifyContent: 'center' },
  spinner: { position: 'absolute' },
});
