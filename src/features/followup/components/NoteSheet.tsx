import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FormField } from '@/features/life';
import { Button, Notice } from '@/shared/components';
import { pickAttachment } from '@/shared/utils/pickFile';
import { useTheme } from '@/theme';
import { followUpActions } from '../hooks/useFollowUp';
import type { Attachment, Contact, NoteKind } from '../types';
import { Chip, ChipRow, Field, Sheet } from './Sheet';

const KINDS: readonly NoteKind[] = ['note', 'call', 'whatsapp', 'meeting'];

/**
 * A quick note, or an interaction the user logs themselves (a call, a
 * WhatsApp chat, a meeting), optionally with a private attachment.
 */
export function NoteSheet({
  contact,
  initialKind = 'note',
  activityId,
  onClose,
}: {
  contact: Contact | null;
  initialKind?: NoteKind;
  activityId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  const [kind, setKind] = useState<NoteKind>(initialKind);
  const [content, setContent] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    setKind(initialKind);
    setContent('');
    setAttachment(null);
    setError(null);
  }, [contact?.id, initialKind]);

  if (!contact) return null;

  const save = () => {
    if (saving.current) return;
    saving.current = true;
    const result = followUpActions.addNote({
      contactId: contact.id,
      kind,
      content,
      activityId,
      attachment,
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
      title={t('followUp.addNote')}
      subtitle={contact.name}
      onClose={onClose}
      testID="note-sheet"
      footer={
        <Button
          label={t('followUp.saveNote')}
          onPress={save}
          testID="note-save"
        />
      }
    >
      {error ? <Notice tone="error" message={error} /> : null}
      <Field label={t('followUp.noteKind')}>
        <ChipRow>
          {KINDS.map(k => (
            <Chip
              key={k}
              label={t(`followUp.noteKind_${k}`)}
              selected={kind === k}
              onPress={() => setKind(k)}
              testID={`note-kind-${k}`}
            />
          ))}
        </ChipRow>
      </Field>
      <FormField
        label={t('followUp.noteText')}
        value={content}
        onChangeText={text => {
          setContent(text);
          setError(null);
        }}
        placeholder={t('followUp.notePlaceholder')}
        multiline
        autoFocus
        maxLength={1000}
        testID="note-text"
      />
      {attachment ? (
        <Text
          style={[typography.caption, { color: colors.textSecondary }]}
          numberOfLines={1}
        >
          {t('followUp.attached', { name: attachment.name })}
        </Text>
      ) : null}
      <Button
        variant="soft"
        size="sm"
        iconName="image"
        label={
          attachment ? t('followUp.replaceAttachment') : t('followUp.attach')
        }
        onPress={() => {
          void pickAttachment().then(file => file && setAttachment(file));
        }}
        testID="note-attach"
      />
    </Sheet>
  );
}
