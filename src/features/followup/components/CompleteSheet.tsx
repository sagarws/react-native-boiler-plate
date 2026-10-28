import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DateField, FormField } from '@/features/life';
import { Button, Notice, ToggleSwitch } from '@/shared/components';
import { todayKey, type DayKey } from '@/shared/utils/dayKey';
import { useTheme } from '@/theme';
import { followUpActions, useFollowUpData } from '../hooks/useFollowUp';
import {
  OUTCOMES,
  type Contact,
  type FollowUpActivity,
  type Outcome,
} from '../types';
import { instantOf, parseTime, timeOf } from '../utils/time';
import {
  draftToInput,
  ScheduleFields,
  type ScheduleDraft,
} from './ScheduleFields';
import { Chip, ChipRow, Field, Sheet } from './Sheet';

/**
 * Marks a follow-up done: outcome, optional note, when it happened, and
 * optionally the next follow-up (a new record — the completed one is kept).
 */
export function CompleteSheet({
  contact,
  activity,
  initialOutcome,
  onClose,
}: {
  contact: Contact | null;
  activity: FollowUpActivity | null;
  initialOutcome?: Outcome;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { settings } = useFollowUpData();
  const today = todayKey();
  const [outcome, setOutcome] = useState<Outcome | null>(
    initialOutcome ?? null,
  );
  const [note, setNote] = useState('');
  const [day, setDay] = useState<DayKey>(today);
  const [time, setTime] = useState(() => timeOf(new Date()));
  const [scheduleNext, setScheduleNext] = useState(false);
  const [next, setNext] = useState<ScheduleDraft>({
    day: null,
    time: '',
    type: settings.defaultType,
    purpose: '',
    reminder: settings.reminderByDefault,
  });
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    setOutcome(initialOutcome ?? null);
    setNote('');
    setDay(todayKey());
    setTime(timeOf(new Date()));
    setScheduleNext(false);
    setNext({
      day: null,
      time: '',
      type: activity?.type ?? settings.defaultType,
      purpose: '',
      reminder: settings.reminderByDefault,
    });
    setError(null);
    // Reset only when another follow-up is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity?.id]);

  if (!contact || !activity) return null;

  const save = () => {
    if (saving.current) return;
    if (!outcome) {
      setError(t('followUp.error_outcome_required'));
      return;
    }
    const at = parseTime(time);
    if (!at) {
      setError(t('followUp.error_time_invalid'));
      return;
    }
    const completedAt = instantOf(day, at);
    if (completedAt.getTime() > Date.now() + 60_000) {
      setError(t('followUp.error_future_completion'));
      return;
    }
    let nextInput;
    if (scheduleNext) {
      const parsed = draftToInput(next);
      if (!parsed.ok) {
        setError(
          t(
            parsed.error === 'date'
              ? 'followUp.error_next_date'
              : 'followUp.error_time_invalid',
          ),
        );
        return;
      }
      nextInput = parsed.value;
    }
    saving.current = true;
    const result = followUpActions.complete(activity.id, {
      outcome,
      note,
      completedAt,
      next: nextInput,
    });
    saving.current = false;
    if (!result.ok) {
      setError(t(`followUp.error_${result.error}`));
      return;
    }
    onClose();
  };

  return (
    <Sheet
      visible
      title={t('followUp.completeTitle')}
      subtitle={contact.name}
      onClose={onClose}
      testID="complete-sheet"
      footer={
        <Button
          label={t('followUp.markDone')}
          onPress={save}
          testID="complete-save"
        />
      }
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <Field label={t('followUp.outcome')}>
        <ChipRow>
          {OUTCOMES.map(o => (
            <Chip
              key={o}
              label={t(`followUp.outcome_${o}`)}
              selected={outcome === o}
              onPress={() => {
                setOutcome(o);
                setError(null);
              }}
              testID={`complete-outcome-${o}`}
            />
          ))}
        </ChipRow>
      </Field>
      <FormField
        label={t('followUp.completionNote')}
        value={note}
        onChangeText={setNote}
        placeholder={t('followUp.completionNotePlaceholder')}
        multiline
        maxLength={1000}
        testID="complete-note"
      />
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <DateField
            label={t('followUp.completedOn')}
            value={day}
            onChange={d => d && setDay(d)}
            today={today}
            testID="complete-day"
          />
        </View>
        <View style={styles.time}>
          <FormField
            label={t('followUp.time')}
            value={time}
            onChangeText={setTime}
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            testID="complete-time"
          />
        </View>
      </View>
      <View style={[styles.row, { gap: spacing.md }]}>
        <View style={styles.flex}>
          <Text style={[typography.label, { color: colors.textPrimary }]}>
            {t('followUp.scheduleNext')}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>
            {t('followUp.scheduleNextHint')}
          </Text>
        </View>
        <ToggleSwitch
          isOn={scheduleNext}
          onToggle={setScheduleNext}
          accessibilityLabel={t('followUp.scheduleNext')}
        />
      </View>
      {scheduleNext ? (
        <ScheduleFields
          value={next}
          onChange={setNext}
          today={today}
          remindersOn={settings.remindersEnabled}
          testID="complete-next"
        />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  flex: { flex: 1 },
  time: { width: 96 },
});
