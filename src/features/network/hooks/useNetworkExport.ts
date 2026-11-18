import { useCallback, useRef, useState } from 'react';
import { logger } from '@/shared/utils';
import { buildExport } from '../services/export.service';
import { networkNative } from '../services/native.service';
import { networkSettingsStore } from '../store/networkSettings.store';

export type ExportTarget = 'share' | 'save';
export type ExportOutcome = 'done' | 'cancelled' | 'empty' | 'failed';

/**
 * JSON export of captured calls to the share sheet or "Save to…", with a
 * busy flag so the button can show progress and ignore double taps.
 */
export function useNetworkExport() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);

  const run = useCallback(
    async (
      ids: string[] | null,
      target: ExportTarget,
    ): Promise<ExportOutcome> => {
      if (running.current) return 'cancelled';
      running.current = true;
      setBusy(true);
      try {
        const { includeSensitive } = networkSettingsStore.read();
        const result = await buildExport(ids, includeSensitive);
        if (!result.count) return 'empty';
        const ok =
          target === 'save'
            ? await networkNative.saveFile(result.fileName, result.json)
            : await networkNative.shareFile(result.fileName, result.json);
        return ok ? 'done' : 'cancelled';
      } catch (error) {
        logger.error(
          'Network Inspector: export failed',
          (error as { code?: string })?.code ?? (error as Error)?.name,
        );
        return 'failed';
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [],
  );

  return { busy, run, canSave: networkNative.canSaveFile() };
}
