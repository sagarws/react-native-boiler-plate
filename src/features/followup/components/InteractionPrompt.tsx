import React from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/components';
import { useTheme } from '@/theme';
import type { PendingInteraction } from '../hooks/useContactLauncher';
import type { FollowUpActivity } from '../types';
import { Sheet } from './Sheet';

/**
 * Shown when the user returns from the dialer or WhatsApp. The app can't
 * tell whether a call connected or a message was sent, so it asks.
 */
export function InteractionPrompt({
  pending,
  openActivity,
  onComplete,
  onLog,
  onDismiss,
}: {
  pending: PendingInteraction | null;
  /** The follow-up to complete: the one acted on, else the contact's next open one. */
  openActivity: FollowUpActivity | null;
  onComplete: () => void;
  onLog: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography } = useTheme();
  if (!pending) return null;
  return (
    <Sheet
      visible
      title={t('followUp.howDidItGo')}
      subtitle={pending.contact.name}
      onClose={onDismiss}
      testID="interaction-prompt"
      footer={
        <>
          {openActivity ? (
            <Button
              label={t('followUp.recordAndComplete')}
              onPress={onComplete}
              testID="prompt-complete"
            />
          ) : null}
          <Button
            variant={openActivity ? 'soft' : 'primary'}
            label={t('followUp.logInteractionOnly')}
            onPress={onLog}
            testID="prompt-log"
          />
          <Button
            variant="ghost"
            label={t('followUp.nothingToRecord')}
            onPress={onDismiss}
            testID="prompt-dismiss"
          />
        </>
      }
    >
      <Text style={[typography.body, { color: colors.textSecondary }]}>
        {t(
          pending.channel === 'call'
            ? 'followUp.promptAfterCall'
            : 'followUp.promptAfterWhatsApp',
        )}
      </Text>
    </Sheet>
  );
}
