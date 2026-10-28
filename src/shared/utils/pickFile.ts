import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
import { logger } from './logger';

export interface PickedFile {
  uri: string;
  name: string;
  mime: string;
}

/**
 * Picks one file with the system picker and keeps a private copy in app
 * storage (so it survives the original being moved or deleted). Resolves
 * null when cancelled or unavailable; never throws.
 */
async function pickCopy(type: string[]): Promise<PickedFile | null> {
  try {
    const [file] = await pick({ type });
    if (!file || file.error) return null;
    const name = file.name ?? 'file';
    const [copy] = await keepLocalCopy({
      files: [{ uri: file.uri, fileName: name }],
      destination: 'documentDirectory',
    });
    return copy?.status === 'success'
      ? { uri: copy.localUri, name, mime: file.type ?? '' }
      : null;
  } catch (error) {
    if (
      !(isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED)
    ) {
      logger.warn('file pick failed', (error as Error)?.message);
    }
    return null;
  }
}

/** A picture, copied into app storage; resolves its local URI or null. */
export async function pickPicture(): Promise<string | null> {
  return (await pickCopy([types.images]))?.uri ?? null;
}

/** Any file (image, PDF, document), copied into app storage. */
export const pickAttachment = (): Promise<PickedFile | null> =>
  pickCopy([types.allFiles]);
