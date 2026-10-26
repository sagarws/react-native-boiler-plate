import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import { useTheme } from '@/theme';
import { OCR_MODES, type OcrMode } from '../capture.types';

export interface OcrModePickerProps {
  value: OcrMode;
  onChange: (mode: OcrMode) => void;
}

/** Radio list of the three OCR modes, each with what it is best for. */
export function OcrModePicker({ value, onChange }: OcrModePickerProps) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('ocrMode.label')}
      style={{ gap: spacing.sm }}
    >
      {OCR_MODES.map(mode => {
        const selected = mode === value;
        return (
          <Pressable
            key={mode}
            testID={`ocr-mode-${mode}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, selected }}
            accessibilityLabel={t(`ocrMode.${mode}`)}
            accessibilityHint={t(`ocrMode.${mode}_description`)}
            onPress={() => onChange(mode)}
            style={({ pressed }) => [
              styles.option,
              {
                borderRadius: radius.lg,
                padding: spacing.md,
                gap: spacing.md,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected
                  ? colors.primarySoft
                  : pressed
                  ? colors.surfaceMuted
                  : colors.surface,
              },
            ]}
          >
            <View
              style={[
                styles.badge,
                {
                  borderRadius: radius.md,
                  backgroundColor: selected
                    ? colors.primary
                    : colors.surfaceMuted,
                },
              ]}
            >
              <Text
                style={[
                  typography.label,
                  {
                    color: selected
                      ? colors.primaryForeground
                      : colors.textSecondary,
                  },
                ]}
              >
                {t(`ocrMode.${mode}_short`)}
              </Text>
            </View>
            <View style={styles.text}>
              <Text style={[typography.label, { color: colors.textPrimary }]}>
                {t(`ocrMode.${mode}`)}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t(`ocrMode.${mode}_description`)}
              </Text>
            </View>
            <View
              style={[
                styles.radio,
                { borderColor: selected ? colors.primary : colors.placeholder },
                selected && { backgroundColor: colors.primary },
              ]}
            >
              {selected ? (
                <Icon name="check" size={14} color={colors.primaryForeground} />
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    minHeight: 64,
  },
  badge: {
    minWidth: 52,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  text: { flex: 1 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
