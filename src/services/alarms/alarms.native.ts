import { DeviceEventEmitter } from 'react-native';
import NativeAlarms from '@/specs/NativeAlarms';
import { logger } from '@/shared/utils';
import type { AlarmEntry, AlarmGroup, SyncResult } from './types';

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || 'failed';

/**
 * The shared alarm engine (Reminders + Utility timers). Each group's alarms
 * are replaced as a whole, so there are never stale or duplicate alarms.
 * Alarm texts are never logged.
 */
export const alarms = {
  available: (): boolean => NativeAlarms != null,

  async sync(group: AlarmGroup, entries: AlarmEntry[]): Promise<SyncResult> {
    if (!NativeAlarms) return { kind: 'unavailable' };
    try {
      const r = JSON.parse(
        await NativeAlarms.sync(group, JSON.stringify(entries)),
      ) as { armed?: number; exact?: boolean };
      return {
        kind: 'scheduled',
        armed: typeof r.armed === 'number' ? r.armed : 0,
        exact: r.exact !== false,
      };
    } catch (error) {
      logger.warn('alarm sync failed', group, errorCode(error));
      return { kind: 'failed' };
    }
  },

  /** Stops [key] if it rings and clears its notification. */
  dismiss(key: string) {
    NativeAlarms?.dismiss(key);
  },

  async ringing(): Promise<string> {
    return NativeAlarms ? NativeAlarms.getRinging() : '';
  },

  /** Calls [listener] with the key of each alarm that fires while the app runs. */
  onFired(listener: (key: string) => void): () => void {
    const sub = DeviceEventEmitter.addListener(
      'AlarmFired',
      (e: { key?: string }) => e?.key && listener(e.key),
    );
    return () => sub.remove();
  },

  /** {uri, title} or null when cancelled / unavailable. */
  async pickRingtone(
    current: string,
  ): Promise<{ uri: string; title: string } | null> {
    if (!NativeAlarms) return null;
    try {
      const raw = await NativeAlarms.pickRingtone(current);
      if (!raw) return null;
      const r = JSON.parse(raw) as { uri?: unknown; title?: unknown };
      return {
        uri: typeof r.uri === 'string' ? r.uri : '',
        title: typeof r.title === 'string' ? r.title : '',
      };
    } catch (error) {
      logger.warn('ringtone picker failed', errorCode(error));
      return null;
    }
  },

  async preview(uri: string, volume: number): Promise<boolean> {
    if (!NativeAlarms) return false;
    try {
      return await NativeAlarms.previewRingtone(uri, volume);
    } catch {
      return false;
    }
  },
  stopPreview() {
    NativeAlarms?.stopPreview();
  },

  async hasVibrator(): Promise<boolean> {
    return NativeAlarms ? NativeAlarms.hasVibrator() : false;
  },
  async canScheduleExact(): Promise<boolean> {
    return NativeAlarms ? NativeAlarms.canScheduleExactAlarms() : true;
  },
  openExactAlarmSettings() {
    NativeAlarms?.openExactAlarmSettings();
  },
  async canUseFullScreen(): Promise<boolean> {
    return NativeAlarms ? NativeAlarms.canUseFullScreenIntent() : true;
  },
  openFullScreenSettings() {
    NativeAlarms?.openFullScreenIntentSettings();
  },
};
