import { useCallback, useMemo } from 'react';
import { logger } from '@/shared/utils';
import { networkRepository } from '../repository/network.repository';
import { prepareForExport } from '../services/export.service';
import { networkNative } from '../services/native.service';
import type { CapturedRequest } from '../types';
import { bodyToText } from '../utils/filters';
import { useCallSummaries } from './useCapturedCalls';
import { useNetworkSettings } from './useNetworkSettings';

export type CopyPart = 'url' | 'requestBody' | 'responseBody' | 'curl';

export interface CallDetail {
  /** The stored record (originals, for display); null when deleted/missing. */
  record: CapturedRequest | null;
  /** What copies use: redacted unless the user opted in. */
  shareable: CapturedRequest | null;
  includeSensitive: boolean;
  copy: (part: CopyPart) => Promise<boolean>;
  remove: () => boolean;
}

export function useCallDetail(id: string): CallDetail {
  // Re-read when the stored call changes (e.g. its response arrives).
  const summaries = useCallSummaries();
  const summary = summaries.find(s => s.id === id);
  const { includeSensitive } = useNetworkSettings();

  const record = useMemo(
    () => (summary ? networkRepository.get(id) : null),
    // The summary object is replaced whenever the record is written.
    [summary, id],
  );
  const shareable = useMemo(
    () => (record ? prepareForExport(record, includeSensitive) : null),
    [record, includeSensitive],
  );

  const copy = useCallback(
    async (part: CopyPart) => {
      if (!shareable) return false;
      const text =
        part === 'url'
          ? shareable.url
          : part === 'curl'
          ? shareable.curl
          : bodyToText(
              part === 'requestBody'
                ? shareable.requestBody
                : shareable.responseBody,
            );
      if (!text) return false;
      return networkNative.copy(text);
    },
    [shareable],
  );

  const remove = useCallback(() => {
    try {
      networkRepository.remove([id]);
      return true;
    } catch (error) {
      logger.error('Network Inspector: delete failed', (error as Error)?.name);
      return false;
    }
  }, [id]);

  return { record, shareable, includeSensitive, copy, remove };
}
