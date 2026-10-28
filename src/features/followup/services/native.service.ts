import NativeFollowUp from '@/specs/NativeFollowUp';
import { logger } from '@/shared/utils';

export interface NativeReminder {
  key: string;
  at: number;
  title: string;
  body: string;
  contactId: string;
}

/** Why a native call didn't do what was asked. */
export type NativeOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'unavailable' | 'blocked' | 'failed' };

/**
 * Follow Up's bridge to Android (reminders, saving files, opening
 * attachments). Contact details passed here stay on the device and are never
 * logged.
 */
export const followUpNative = {
  available: (): boolean => NativeFollowUp != null,

  async syncReminders(list: NativeReminder[]): Promise<NativeOutcome<number>> {
    if (!NativeFollowUp) return { ok: false, error: 'unavailable' };
    try {
      const count = await NativeFollowUp.syncReminders(JSON.stringify(list));
      return count < 0
        ? { ok: false, error: 'blocked' }
        : { ok: true, value: count };
    } catch (error) {
      logger.warn('followUp syncReminders failed', (error as Error)?.message);
      return { ok: false, error: 'failed' };
    }
  },

  async saveText(
    fileName: string,
    mime: string,
    content: string,
  ): Promise<NativeOutcome<boolean>> {
    if (!NativeFollowUp) return { ok: false, error: 'unavailable' };
    try {
      return {
        ok: true,
        value: await NativeFollowUp.saveTextDocument(fileName, mime, content),
      };
    } catch (error) {
      logger.warn('followUp save failed', (error as Error)?.message);
      return { ok: false, error: 'failed' };
    }
  },

  async openAttachment(uri: string, mime: string): Promise<boolean> {
    if (!NativeFollowUp) return false;
    try {
      return await NativeFollowUp.openAttachment(uri, mime || '*/*');
    } catch (error) {
      logger.warn('followUp openAttachment failed', (error as Error)?.message);
      return false;
    }
  },
};
