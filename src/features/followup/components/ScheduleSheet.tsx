import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Notice } from '@/shared/components';
import { todayKey } from '@/shared/utils/dayKey';
import { followUpActions, useFollowUpData } from '../hooks/useFollowUp';
import type { Contact, FollowUpActivity } from '../types';
import {
  draftToInput,
  ScheduleFields,
  type ScheduleDraft,
} from './ScheduleFields';
import { Sheet } from './Sheet';

/** Schedule a new follow-up for [contact], or change [activity]. */
export function ScheduleSheet({
  contact,
  activity,
  onClose,
}: {
  contact: Contact | null;
  activity?: FollowUpActivity | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useFollowUpData();
  const today = todayKey();
  const blank = (): ScheduleDraft => ({
    day: activity?.day ?? null,
    time: activity?.time ?? '',
    type: activity?.type ?? settings.defaultType,
    purpose: activity?.purpose ?? '',
    reminder: activity?.reminder ?? settings.reminderByDefault,
  });
  const [draft, setDraft] = useState<ScheduleDraft>(blank);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    setDraft(blank());
    setError(null);
    // Reset only when a different contact/follow-up is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact?.id, activity?.id]);

  if (!contact) return null;

  const save = () => {
    if (saving.current) return;
    const input = draftToInput(draft);
    if (!input.ok) {
      setError(
        t(
          input.error === 'date'
            ? 'followUp.error_date_invalid'
            : 'followUp.error_time_invalid',
        ),
      );
      return;
    }
    saving.current = true;
    const result = activity
      ? followUpActions.editFollowUp(activity.id, input.value)
      : followUpActions.schedule(contact.id, input.value);
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
      title={
        activity ? t('followUp.editFollowUp') : t('followUp.scheduleTitle')
      }
      subtitle={contact.name}
      onClose={onClose}
      testID="schedule-sheet"
      footer={
        <Button
          label={activity ? t('followUp.saveChanges') : t('followUp.schedule')}
          onPress={save}
          testID="schedule-save"
        />
      }
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <ScheduleFields
        value={draft}
        onChange={next => {
          setDraft(next);
          setError(null);
        }}
        today={today}
        remindersOn={settings.remindersEnabled}
        testID="schedule"
      />
    </Sheet>
  );
}
