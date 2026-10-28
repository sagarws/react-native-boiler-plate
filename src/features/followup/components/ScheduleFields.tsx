import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DateField, FormField } from '@/features/life';
import { ToggleSwitch } from '@/shared/components';
import { addDays, type DayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import type { ScheduleInput } from '../store/followup.store';
import { FOLLOW_UP_TYPES, type FollowUpType } from '../types';
import { parseTime } from '../utils/time';
import { Chip, ChipRow, Field } from './Sheet';

export interface ScheduleDraft {
  day: DayKey | null;
  /** As typed; '' = no time. */
  time: string;
  type: FollowUpType;
  purpose: string;
  reminder: boolean;
}

const TYPE_ICON = {
  call: 'phone',
  whatsapp: 'messageCircle',
  meeting: 'users',
  other: 'stickyNote',
} as const;

const QUICK_TIMES = ['09:00', '12:00', '15:00', '18:00'];

/** The draft as a schedule input, or an error key ('date'/'time') when invalid. */
export function draftToInput(
  d: ScheduleDraft,
): { ok: true; value: ScheduleInput } | { ok: false; error: 'date' | 'time' } {
  if (!d.day) return { ok: false, error: 'date' };
  const time = d.time.trim() ? parseTime(d.time) : '';
  if (time === null) return { ok: false, error: 'time' };
  return {
    ok: true,
    value: {
      day: d.day,
      time,
      type: d.type,
      purpose: d.purpose,
      reminder: d.reminder,
    },
  };
}

/** Date, time, type, purpose and reminder for one follow-up. */
export function ScheduleFields({
  value,
  onChange,
  today,
  remindersOn,
  testID,
}: {
  value: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  today: DayKey;
  /** Whether reminders are switched on in Follow Up settings. */
  remindersOn: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const set = (patch: Partial<ScheduleDraft>) =>
    onChange({ ...value, ...patch });
  const timeInvalid = !!value.time.trim() && parseTime(value.time) === null;
  return (
    <View style={{ gap: spacing.md }}>
      <ChipRow>
        <Chip
          label={t('followUp.today')}
          selected={value.day === today}
          onPress={() => set({ day: today })}
          testID={`${testID}-today`}
        />
        <Chip
          label={t('followUp.tomorrow')}
          selected={value.day === addDays(today, 1)}
          onPress={() => set({ day: addDays(today, 1) })}
          testID={`${testID}-tomorrow`}
        />
        <Chip
          label={t('followUp.inAWeek')}
          selected={value.day === addDays(today, 7)}
          onPress={() => set({ day: addDays(today, 7) })}
          testID={`${testID}-week`}
        />
      </ChipRow>
      <DateField
        label={t('followUp.date')}
        value={value.day}
        onChange={day => set({ day })}
        today={today}
        min={today}
        emptyLabel={t('followUp.pickDate')}
        testID={`${testID}-date`}
      />
      <Field label={t('followUp.time')}>
        <ChipRow>
          <Chip
            label={t('followUp.noTime')}
            selected={!value.time.trim()}
            onPress={() => set({ time: '' })}
            testID={`${testID}-notime`}
          />
          {QUICK_TIMES.map(time => (
            <Chip
              key={time}
              label={time}
              selected={parseTime(value.time) === time}
              onPress={() => set({ time })}
              testID={`${testID}-time-${time}`}
            />
          ))}
        </ChipRow>
        <FormField
          label={t('followUp.customTime')}
          value={value.time}
          onChangeText={time => set({ time })}
          placeholder="14:30"
          keyboardType="numbers-and-punctuation"
          maxLength={5}
          testID={`${testID}-time`}
        />
        {timeInvalid ? (
          <Text style={[typography.caption, { color: colors.error }]}>
            {t('followUp.error_time_invalid')}
          </Text>
        ) : null}
      </Field>
      <Field label={t('followUp.type')}>
        <ChipRow>
          {FOLLOW_UP_TYPES.map(type => (
            <Chip
              key={type}
              icon={TYPE_ICON[type]}
              label={t(`followUp.type_${type}`)}
              selected={value.type === type}
              onPress={() => set({ type })}
              testID={`${testID}-type-${type}`}
            />
          ))}
        </ChipRow>
      </Field>
      <FormField
        label={t('followUp.purpose')}
        value={value.purpose}
        onChangeText={purpose => set({ purpose })}
        placeholder={t('followUp.purposePlaceholder')}
        multiline
        maxLength={1000}
        testID={`${testID}-purpose`}
      />
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {t('followUp.reminder')}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {remindersOn
              ? t('followUp.reminderHint')
              : t('followUp.remindersOffHint')}
          </Text>
        </View>
        <ToggleSwitch
          isOn={value.reminder && remindersOn}
          disabled={!remindersOn}
          onToggle={reminder => set({ reminder })}
          accessibilityLabel={t('followUp.reminder')}
        />
      </View>
    </View>
  );
}

export const TYPE_ICONS = TYPE_ICON;

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
});
