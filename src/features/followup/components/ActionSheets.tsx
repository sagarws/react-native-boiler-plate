import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/features/life';
import { Button, Notice } from '@/shared/components';
import { useContactLauncher } from '../hooks/useContactLauncher';
import { useFollowUpData } from '../hooks/useFollowUp';
import { isOpen, scheduledMs } from '../services/status';
import type { Contact, FollowUpActivity, NoteKind, Outcome } from '../types';
import { CompleteSheet } from './CompleteSheet';
import { InteractionPrompt } from './InteractionPrompt';
import { NoteSheet } from './NoteSheet';
import { ScheduleSheet } from './ScheduleSheet';
import { Sheet } from './Sheet';

type Open =
  | { kind: 'schedule'; contact: Contact; activity: FollowUpActivity | null }
  | {
      kind: 'complete';
      contact: Contact;
      activity: FollowUpActivity;
      outcome?: Outcome;
    }
  | { kind: 'note'; contact: Contact; noteKind: NoteKind; activityId?: string }
  | { kind: 'whatsapp'; contact: Contact; activity: FollowUpActivity | null }
  | null;

/**
 * Every quick action on a contact — call, WhatsApp, schedule, complete,
 * note — with its sheet, plus the "how did it go?" prompt after a call or
 * chat. Screens render `element` once and call the handlers.
 */
export function useActionSheets() {
  const { t } = useTranslation();
  const data = useFollowUpData();
  const launcher = useContactLauncher();
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState('');
  const close = () => setOpen(null);

  const nextOpen = (contactId: string) =>
    data.activities
      .filter(a => a.contactId === contactId && isOpen(a))
      .sort((a, b) => scheduledMs(a) - scheduledMs(b))[0] ?? null;

  const pending = launcher.prompt;
  const promptActivity = pending
    ? (pending.activity &&
        data.activities.find(
          a => a.id === pending.activity!.id && isOpen(a),
        )) ||
      nextOpen(pending.contact.id)
    : null;

  const element = (
    <>
      {launcher.failure ? (
        <Notice
          tone="error"
          message={t(
            launcher.failure === 'no_number'
              ? 'followUp.error_no_number'
              : 'followUp.error_cannot_open',
          )}
          onDismiss={launcher.clearFailure}
        />
      ) : null}
      <ScheduleSheet
        contact={open?.kind === 'schedule' ? open.contact : null}
        activity={open?.kind === 'schedule' ? open.activity : null}
        onClose={close}
      />
      <CompleteSheet
        contact={open?.kind === 'complete' ? open.contact : null}
        activity={open?.kind === 'complete' ? open.activity : null}
        initialOutcome={open?.kind === 'complete' ? open.outcome : undefined}
        onClose={close}
      />
      <NoteSheet
        contact={open?.kind === 'note' ? open.contact : null}
        initialKind={open?.kind === 'note' ? open.noteKind : 'note'}
        activityId={open?.kind === 'note' ? open.activityId : undefined}
        onClose={close}
      />
      {open?.kind === 'whatsapp' ? (
        <Sheet
          visible
          title={t('followUp.whatsappTitle')}
          subtitle={open.contact.name}
          onClose={close}
          testID="whatsapp-sheet"
          footer={
            <Button
              label={t('followUp.openWhatsApp')}
              iconName="messageCircle"
              onPress={() => {
                const { contact, activity } = open;
                close();
                void launcher.whatsapp(contact, activity, message);
                setMessage('');
              }}
              testID="whatsapp-open"
            />
          }
        >
          <FormField
            label={t('followUp.whatsappMessage')}
            hint={t('followUp.whatsappHint')}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={1000}
            testID="whatsapp-message"
          />
        </Sheet>
      ) : null}
      <InteractionPrompt
        pending={pending}
        openActivity={promptActivity}
        onDismiss={launcher.dismissPrompt}
        onComplete={() => {
          if (!pending || !promptActivity) return;
          launcher.dismissPrompt();
          setOpen({
            kind: 'complete',
            contact: pending.contact,
            activity: promptActivity,
          });
        }}
        onLog={() => {
          if (!pending) return;
          launcher.dismissPrompt();
          setOpen({
            kind: 'note',
            contact: pending.contact,
            noteKind: pending.channel,
          });
        }}
      />
    </>
  );

  return {
    element,
    call: (contact: Contact, activity?: FollowUpActivity | null) => {
      void launcher.call(contact, activity);
    },
    whatsapp: (contact: Contact, activity?: FollowUpActivity | null) =>
      setOpen({ kind: 'whatsapp', contact, activity: activity ?? null }),
    schedule: (contact: Contact, activity?: FollowUpActivity | null) =>
      setOpen({ kind: 'schedule', contact, activity: activity ?? null }),
    complete: (contact: Contact, activity: FollowUpActivity) =>
      setOpen({ kind: 'complete', contact, activity }),
    note: (contact: Contact, noteKind: NoteKind = 'note') =>
      setOpen({ kind: 'note', contact, noteKind }),
  };
}
