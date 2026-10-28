import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { isDayKey, todayKey, type DayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';

/**
 * Day / month / year boxes — faster than paging a calendar back decades.
 * Reports a valid past date, '' when empty, or null while incomplete/invalid.
 */
export function BirthDateInput({
  value,
  onChange,
  testID,
}: {
  value: DayKey | '';
  onChange: (next: DayKey | '' | null) => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  const [day, setDay] = useState(value ? String(Number(value.slice(8))) : '');
  const [month, setMonth] = useState(
    value ? String(Number(value.slice(5, 7))) : '',
  );
  const [year, setYear] = useState(value ? value.slice(0, 4) : '');

  useEffect(() => {
    if (!day && !month && !year) {
      onChange('');
      return;
    }
    const key = `${year.padStart(4, '0')}-${month.padStart(
      2,
      '0',
    )}-${day.padStart(2, '0')}`;
    onChange(
      year.length === 4 && isDayKey(key) && key <= todayKey() ? key : null,
    );
    // onChange is a fresh closure each render; only the parts matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, month, year]);

  const box = (
    text: string,
    set: (s: string) => void,
    label: string,
    max: number,
    id: string,
    wide?: boolean,
  ) => (
    <View style={[wide ? styles.wide : styles.box, { gap: spacing.xs }]}>
      <TextInput
        testID={`${testID}-${id}`}
        value={text}
        onChangeText={s => set(s.replace(/\D/g, '').slice(0, max))}
        keyboardType="number-pad"
        maxLength={max}
        placeholder={label}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={`${t('followUp.birthDate')}: ${label}`}
        style={[
          typography.body,
          styles.input,
          {
            color: colors.textPrimary,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
          },
        ]}
      />
    </View>
  );

  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={[typography.label, { color: colors.textPrimary }]}>
        {t('followUp.birthDate')}
      </Text>
      <View style={[styles.row, { gap: spacing.sm }]}>
        {box(day, setDay, t('followUp.dd'), 2, 'day')}
        {box(month, setMonth, t('followUp.mm'), 2, 'month')}
        {box(year, setYear, t('followUp.yyyy'), 4, 'year', true)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  box: { width: 72 },
  wide: { width: 104 },
  input: { borderWidth: 1, minHeight: 48, textAlign: 'center' },
});
