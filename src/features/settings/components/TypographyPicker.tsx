import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import {
  buildTypography,
  TYPOGRAPHY_PRESET_IDS,
  typographyPreference,
  useTheme,
  type TypographyPresetId,
} from '@/theme';

/** Exactly two text styles, each previewed in its own face (Hindi included). */
export function TypographyPicker() {
  const { t } = useTranslation();
  const { colors, radius, spacing, typography, typographyPreset } = useTheme();

  return (
    <View style={{ gap: spacing.sm }} accessibilityRole="radiogroup">
      {TYPOGRAPHY_PRESET_IDS.map((id: TypographyPresetId) => {
        const sample = buildTypography(id);
        const selected = id === typographyPreset;
        const name = t(`appearance.typography_${id}`);
        return (
          <Pressable
            key={id}
            testID={`typography-${id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, selected }}
            accessibilityLabel={t('appearance.selectTypography', { name })}
            onPress={() => typographyPreference.set(id)}
            style={[
              styles.option,
              {
                borderRadius: radius.lg,
                padding: spacing.md,
                gap: spacing.md,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primarySoft : colors.surface,
              },
            ]}
          >
            <Text
              style={[sample.h1, styles.sample, { color: colors.textPrimary }]}
            >
              {t('appearance.typographySample')}
            </Text>
            <View style={styles.text}>
              <Text style={[sample.title, { color: colors.textPrimary }]}>
                {name}
              </Text>
              <Text
                style={[typography.caption, { color: colors.textSecondary }]}
              >
                {t(`appearance.typography_${id}_description`)}
              </Text>
            </View>
            {selected ? (
              <Icon name="circleCheck" size={22} color={colors.primaryText} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5 },
  sample: { width: 112 },
  text: { flex: 1 },
});
