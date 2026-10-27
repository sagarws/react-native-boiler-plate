import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import { logger } from '@/shared/utils';
import type { PickedFile } from '../types';

/** The system file picker (Storage Access Framework). Null when cancelled. */
export async function pickFile(): Promise<PickedFile | null> {
  try {
    const [file] = await pick({ type: [types.allFiles] });
    if (!file || file.error) {
      if (file?.error)
        logger.warn('pickFile: picked file unreadable', file.error);
      return null;
    }
    return {
      uri: file.uri,
      name: file.name || 'file',
      mimeType: file.type || 'application/octet-stream',
      size: file.size ?? 0,
    };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
      return null;
    logger.error('pickFile failed', error);
    throw error;
  }
}
