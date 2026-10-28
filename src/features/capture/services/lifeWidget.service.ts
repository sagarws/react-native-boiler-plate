import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';

/**
 * Manage Life's bridge to the native home-screen widget. Lives in
 * capture/services because only this folder may use the native module. The
 * snapshot holds the user's own task names and numbers; it stays on the
 * device and is never logged.
 */
export interface WidgetLogEntry {
  id: string;
  task: string;
  /** "YYYY-MM-DD", the local day the "+" was tapped. */
  day: string;
  q: number;
  /** Epoch millis of the tap. */
  at: number;
}

/** Parses the native queue, dropping anything malformed. */
export function parseWidgetLogs(json: string): WidgetLogEntry[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is WidgetLogEntry =>
        !!e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.task === 'string' &&
        typeof e.day === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.day) &&
        typeof e.q === 'number' &&
        Number.isFinite(e.q) &&
        e.q > 0 &&
        typeof e.at === 'number' &&
        Number.isFinite(e.at),
    );
  } catch {
    return [];
  }
}

export const lifeWidgetService = {
  push(snapshot: string): void {
    try {
      NativeScreenOcr?.updateLifeWidget(snapshot);
    } catch (error) {
      logger.warn('lifeWidget push failed', (error as Error)?.message);
    }
  },

  async takeLogs(): Promise<WidgetLogEntry[]> {
    if (!NativeScreenOcr) return [];
    try {
      return parseWidgetLogs(await NativeScreenOcr.takeLifeWidgetLogs());
    } catch (error) {
      logger.warn('lifeWidget takeLogs failed', (error as Error)?.message);
      return [];
    }
  },
};
