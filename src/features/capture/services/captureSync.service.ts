import { captureSettingsStore } from '../store/captureSettings.store';
import { historyStore } from '../store/history.store';
import { latestResultStore } from '../store/latestResult.store';
import { screenOcrService } from './screenOcr.service';

/**
 * Brings the JS side up to date with captures the native service made —
 * possibly while the app was in the background or not running at all.
 *
 * The service queues results only while history is on; the settings check
 * here also covers results queued just before the user turned it off.
 */
export async function syncCaptures(): Promise<void> {
  const [pending, latest] = await Promise.all([
    screenOcrService.drainPending(),
    screenOcrService.latest(),
  ]);
  if (pending.length > 0 && captureSettingsStore.read().saveHistory) {
    historyStore.add(pending);
  }
  latestResultStore.set(latest);
}

/** Deletes every stored extraction, on both sides of the bridge. */
export function clearAllCaptures(): void {
  historyStore.clear();
  latestResultStore.set(null);
  screenOcrService.clearCapturedData();
}
