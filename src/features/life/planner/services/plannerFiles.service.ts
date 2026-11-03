import NativeLifeBackup from '@/specs/NativeLifeBackup';
import { logger } from '@/shared/utils';
import type { Attachment } from '../types';

/** Opening planner attachments (private app files) in a viewer app. */
export const plannerFiles = {
  async open(a: Attachment): Promise<boolean> {
    if (!NativeLifeBackup) return false;
    try {
      return await NativeLifeBackup.openFile(a.uri, a.mime || '*/*');
    } catch (error) {
      logger.warn('planner attachment open failed', (error as Error)?.message);
      return false;
    }
  },
};
