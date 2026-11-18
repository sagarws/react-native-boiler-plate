import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FormField } from '@/features/life';
import { Header } from '@/shared/components';
import { useTheme } from '@/theme';
import {
  CONVERT_CATEGORIES,
  DEFAULT_UNIT,
  convert,
  formatNumber,
  parseNumber,
  unitsOf,
  type ConvertCategory,
} from '../services/convert';

/**
 * Unit converter (offline): pick a category and a unit, type a value, and
 * see it in every other unit of that category. Tap a result to convert from
 * that unit instead.
 */
export default function ConverterScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing, radius } = useTheme();
  const [category, setCategory] = useState<ConvertCategory>('length');
  const [from, setFrom] = useState(DEFAULT_UNIT.length);
  const [text, setText] = useState('1');
  const value = parseNumber(text);
  const invalid = text.trim() !== '' && !Number.isFinite(value);

  const chip = (
    key: string,
    label: string,
    selected: boolean,
    onPress: () => void,
    testID: string,
  ) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.primary : colors.border,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
        },
        selected && { backgroundColor: colors.primarySoft },
      ]}
    >
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={t('utility.tool_converter')} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.xs }}
        >
          {CONVERT_CATEGORIES.map(c =>
            chip(
              c,
              t(`utility.convert_${c}`),
              c === category,
              () => {
                setCategory(c);
                setFrom(DEFAULT_UNIT[c]);
              },
              `convert-cat-${c}`,
            ),
          )}
        </ScrollView>
        <FormField
          label={t('utility.convertValue', {
            unit: t(`utility.unitName_${from}`),
          })}
          value={text}
          onChangeText={setText}
          keyboardType="numbers-and-punctuation"
          maxLength={24}
          testID="convert-value"
        />
        {invalid ? (
          <Text style={[typography.caption, { color: colors.error }]}>
            {t('utility.convertInvalid')}
          </Text>
        ) : null}
        <Text style={[typography.label, { color: colors.textPrimary }]}>
          {t('utility.convertFrom')}
        </Text>
        <View style={[styles.wrap, { gap: spacing.xs }]}>
          {unitsOf(category).map(u =>
            chip(
              u,
              t(`utility.unitName_${u}`),
              u === from,
              () => setFrom(u),
              `convert-from-${u}`,
            ),
          )}
        </View>
        <View
          style={{
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderWidth: StyleSheet.hairlineWidth,
            borderRadius: radius.lg,
          }}
        >
          {unitsOf(category)
            .filter(u => u !== from)
            .map((u, i) => {
              const out = Number.isFinite(value)
                ? convert(category, value, from, u)
                : NaN;
              const shown = formatNumber(out);
              const name = t(`utility.unitName_${u}`);
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    if (Number.isFinite(out))
                      setText(String(Number(out.toPrecision(10))));
                    setFrom(u);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${shown} ${name}`}
                  accessibilityHint={t('utility.convertUseHint')}
                  testID={`convert-out-${u}`}
                  style={[
                    styles.result,
                    {
                      padding: spacing.md,
                      borderTopColor: colors.divider,
                    },
                    i > 0 && styles.divided,
                  ]}
                >
                  <Text
                    style={[
                      typography.body,
                      styles.flex,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {name}
                  </Text>
                  <Text
                    selectable
                    style={[typography.title, { color: colors.textPrimary }]}
                  >
                    {shown}
                  </Text>
                </Pressable>
              );
            })}
        </View>
        {category === 'temperature' &&
        Number.isFinite(value) &&
        !Number.isFinite(convert(category, value, from, 'K')) ? (
          <Text style={[typography.caption, { color: colors.error }]}>
            {t('utility.convertBelowZero')}
          </Text>
        ) : null}
        {category === 'data' ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('utility.convertDataNote')}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: { borderWidth: 1, minHeight: 40, justifyContent: 'center' },
  result: { flexDirection: 'row', alignItems: 'center' },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
});
