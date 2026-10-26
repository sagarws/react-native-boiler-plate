import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/components';
import {
  buildPalette,
  THEME_PRESET_IDS,
  themePresetPreference,
  useTheme,
  type ThemePresetId,
} from '@/theme';

/**
 * The six colour presets, each drawn as a miniature of the app in the current
 * light/dark mode, so the card is the preview. Tapping applies immediately.
 */
export function ThemePresetGrid() {
  const { t } = useTranslation();
  const {
    colors,
    typography,
    radius,
    spacing,
    preset: active,
    scheme,
  } = useTheme();

  return (
    <View
      style={[styles.grid, { gap: spacing.md }]}
      accessibilityRole="radiogroup"
    >
      {THEME_PRESET_IDS.map((id: ThemePresetId) => {
        const p = buildPalette(id, scheme);
        const selected = id === active;
        const name = t(`appearance.preset_${id}`);
        return (
          <Pressable
            key={id}
            testID={`preset-${id}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, selected }}
            accessibilityLabel={t('appearance.selectPreset', { name })}
            onPress={() => themePresetPreference.set(id)}
            style={[
              styles.card,
              {
                borderRadius: radius.lg,
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: colors.surface,
              },
            ]}
          >
            <View
              style={[
                styles.mini,
                { backgroundColor: p.background, borderRadius: radius.md },
              ]}
            >
              <View style={[styles.miniBar, { backgroundColor: p.primary }]} />
              <View
                style={[
                  styles.miniCard,
                  { backgroundColor: p.surface, borderColor: p.border },
                ]}
              >
                <View
                  style={[
                    styles.miniLine,
                    { backgroundColor: p.textPrimary, width: '70%' },
                  ]}
                />
                <View
                  style={[
                    styles.miniLine,
                    { backgroundColor: p.textSecondary, width: '50%' },
                  ]}
                />
                <View
                  style={[styles.miniButton, { backgroundColor: p.primary }]}
                />
              </View>
              {selected ? (
                <View style={[styles.check, { backgroundColor: p.primary }]}>
                  <Icon name="check" size={12} color={p.primaryForeground} />
                </View>
              ) : null}
            </View>
            <Text
              numberOfLines={1}
              style={[
                typography.label,
                { color: colors.textPrimary, marginTop: spacing.sm },
              ]}
            >
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { width: '47%', flexGrow: 1, borderWidth: 2, padding: 8 },
  mini: { height: 84, overflow: 'hidden', padding: 8 },
  miniBar: { height: 10, borderRadius: 5, width: '45%', marginBottom: 8 },
  miniCard: { flex: 1, borderRadius: 6, borderWidth: 1, padding: 6, gap: 4 },
  miniLine: { height: 5, borderRadius: 3 },
  miniButton: { height: 10, width: '40%', borderRadius: 5, marginTop: 'auto' },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
