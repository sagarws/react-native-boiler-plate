import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, ChipRow, Field, parseTime, timeOf } from '@/features/followup';
import { DateField, FormField } from '@/features/life';
import type { MainStackParamList } from '@/navigation/types';
import {
  DEFAULT_ALERT,
  REPEATS,
  type AlertConfig,
  type Repeat,
} from '@/services/alarms';
import {
  AlertSettings,
  Button,
  EmptyState,
  Header,
  ToggleSwitch,
} from '@/shared/components';
import { todayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import { reminderActions, useRemindersData } from '../hooks/useReminders';
import { MAX_DESCRIPTION, MAX_TITLE } from '../services/reminders';
import {
  CATEGORIES,
  CATEGORY_COLOR,
  CATEGORY_ICON,
  type ReminderCategory,
  type ReminderError,
} from '../types';

const QUICK_TIMES = ['07:00', '09:00', '12:00', '15:00', '18:00', '21:00'];

/** One hour from now, on the minute, as the default time. */
const nextHour = () => {
  const d = new Date(Date.now() + 3_600_000);
  d.setMinutes(0, 0, 0);
  return timeOf(d);
};

/** Create or edit a reminder: what, when, repeat, category and how it alerts. */
export default function ReminderFormScreen() {
  const { t } = useTranslation();
  const { top, bottom } = useSafeAreaInsets();
  const { colors, typography, spacing } = useTheme();
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MainStackParamList, 'ReminderForm'>>();
  const reminders = useRemindersData();
  const today = todayKey();
  const existing = params?.reminderId
    ? reminders.find(r => r.id === params.reminderId)
    : undefined;
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [date, setDate] = useState(existing?.date ?? params?.date ?? today);
  const [time, setTime] = useState(existing?.time ?? nextHour());
  const [category, setCategory] = useState<ReminderCategory>(
    existing?.category ?? 'personal',
  );
  const [customLabel, setCustomLabel] = useState(existing?.customLabel ?? '');
  const [repeat, setRepeat] = useState<Repeat>(existing?.repeat ?? 'never');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [alert, setAlert] = useState<AlertConfig>(
    existing?.alert ?? DEFAULT_ALERT,
  );
  const [error, setError] = useState<ReminderError | null>(null);

  if (params?.reminderId && !existing) {
    return (
      <View
        style={[
          styles.screen,
          { backgroundColor: colors.background, paddingTop: top },
        ]}
      >
        <Header label={t('reminders.title')} />
        <EmptyState
          icon="triangleAlert"
          title={t('reminders.error_not_found')}
          testID="reminder-missing"
        />
      </View>
    );
  }

  const pickCategory = (c: ReminderCategory) => {
    setCategory(c);
    // Birthdays come round every year.
    if (c === 'birthday' && repeat === 'never') setRepeat('yearly');
  };

  const save = async () => {
    const parsed = parseTime(time);
    if (!parsed) {
      setError('time_invalid');
      return;
    }
    const input = {
      title,
      description,
      date,
      time: parsed,
      category,
      customLabel,
      repeat,
      alert,
    };
    const r = existing
      ? reminderActions.update(existing.id, input)
      : await reminderActions.create(input);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (existing && existing.enabled !== enabled)
      reminderActions.setEnabled(existing.id, enabled);
    navigation.goBack();
  };

  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert(
      t('reminders.deleteTitle', { title: existing.title }),
      undefined,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('reminders.delete'),
          style: 'destructive',
          onPress: () => {
            reminderActions.remove(existing.id);
            navigation.goBack();
          },
        },
      ],
    );
  };

  const timeInvalid = !!time.trim() && parseTime(time) === null;

  return (
    <View
      style={[
        styles.screen,
        { backgroundColor: colors.background, paddingTop: top },
      ]}
    >
      <Header label={existing ? t('reminders.edit') : t('reminders.new')} />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: bottom + spacing.xl,
          gap: spacing.md,
        }}
      >
        <FormField
          label={t('reminders.titleLabel')}
          placeholder={t('reminders.titlePlaceholder')}
          value={title}
          onChangeText={v => {
            setTitle(v);
            if (error === 'title_required') setError(null);
          }}
          maxLength={MAX_TITLE}
          testID="reminder-title"
        />
        <FormField
          label={t('reminders.descriptionLabel')}
          value={description}
          onChangeText={setDescription}
          maxLength={MAX_DESCRIPTION}
          multiline
          testID="reminder-description"
        />
        <Field label={t('reminders.category')}>
          <ChipRow>
            {CATEGORIES.map(c => (
              <Chip
                key={c}
                label={t(`reminders.category_${c}`)}
                selected={category === c}
                onPress={() => pickCategory(c)}
                color={CATEGORY_COLOR[c]}
                icon={CATEGORY_ICON[c]}
                testID={`reminder-category-${c}`}
              />
            ))}
          </ChipRow>
        </Field>
        {category === 'custom' ? (
          <FormField
            label={t('reminders.customLabel')}
            value={customLabel}
            onChangeText={setCustomLabel}
            maxLength={30}
            testID="reminder-custom-label"
          />
        ) : null}
        <DateField
          label={t('reminders.date')}
          value={date}
          onChange={d => {
            if (d) setDate(d);
            if (error === 'in_past' || error === 'date_invalid') setError(null);
          }}
          today={today}
          min={existing ? undefined : today}
          testID="reminder-date"
        />
        <Field label={t('reminders.time')}>
          <ChipRow>
            {QUICK_TIMES.map(q => (
              <Chip
                key={q}
                label={q}
                selected={parseTime(time) === q}
                onPress={() => {
                  setTime(q);
                  setError(null);
                }}
                testID={`reminder-time-${q}`}
              />
            ))}
          </ChipRow>
          <FormField
            label={t('reminders.exactTime')}
            hint={t('reminders.timeHint')}
            value={time}
            onChangeText={v => {
              setTime(v);
              setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            testID="reminder-time"
          />
          {timeInvalid ? (
            <Text style={[typography.caption, { color: colors.error }]}>
              {t('reminders.error_time_invalid')}
            </Text>
          ) : null}
        </Field>
        <Field label={t('reminders.repeat')}>
          <ChipRow>
            {REPEATS.map(r => (
              <Chip
                key={r}
                label={t(`reminders.repeat_${r}`)}
                selected={repeat === r}
                onPress={() => setRepeat(r)}
                testID={`reminder-repeat-${r}`}
              />
            ))}
          </ChipRow>
        </Field>
        {existing ? (
          <View style={[styles.row, { gap: spacing.md }]}>
            <Text
              style={[
                typography.label,
                styles.flex,
                { color: colors.textPrimary },
              ]}
            >
              {t('reminders.enabled')}
            </Text>
            <ToggleSwitch
              isOn={enabled}
              onToggle={setEnabled}
              accessibilityLabel={t('reminders.enabled')}
            />
          </View>
        ) : null}

        <Text
          style={[
            typography.title,
            { color: colors.textPrimary, marginTop: spacing.sm },
          ]}
        >
          {t('reminders.alertTitle')}
        </Text>
        <AlertSettings
          value={alert}
          onChange={setAlert}
          testID="reminder-alert"
        />

        {error ? (
          <Text
            style={[typography.body, { color: colors.error }]}
            testID="reminder-error"
          >
            {t(`reminders.error_${error}`)}
          </Text>
        ) : null}
        <Button
          label={t('reminders.save')}
          iconName="check"
          onPress={() => {
            void save();
          }}
          testID="reminder-save"
        />
        {existing ? (
          <Button
            variant="danger"
            label={t('reminders.delete')}
            onPress={confirmDelete}
            testID="reminder-delete"
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
