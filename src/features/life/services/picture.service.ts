import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
import { logger } from '@/shared/utils';

/**
 * Picks a picture for a project/task with the system picker and keeps a copy
 * in app storage (so it survives the original being moved or deleted).
 * Resolves the local URI, or null when cancelled / unavailable.
 */
export async function pickPicture(): Promise<string | null> {
  try {
    const [file] = await pick({ type: [types.images] });
    if (!file || file.error) return null;
    const [copy] = await keepLocalCopy({
      files: [{ uri: file.uri, fileName: file.name ?? 'picture.jpg' }],
      destination: 'documentDirectory',
    });
    return copy?.status === 'success' ? copy.localUri : null;
  } catch (error) {
    if (
      !(isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
    ) {
      logger.warn('pickPicture failed', (error as Error)?.message);
    }
    return null;
  }
}
