import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the shared alarm engine
 * (android/app/src/main/java/com/rnboilerplate/alarms/AlarmsModule.kt):
 * scheduled alarms that ring with the app closed, survive reboots and
 * clock / time-zone changes, and offer Snooze / Dismiss.
 *
 * Only `src/services/alarms` may import this file (it's shared by the
 * Reminders feature and Utility's timers). Android only: on iOS (and under
 * Jest) the module is absent and `get` returns null.
 *
 * Events (DeviceEventEmitter): `AlarmFired` {key}.
 */
export interface Spec extends TurboModule {
  /**
   * Replaces every alarm of [group] ('reminder' | 'timer') with the JSON
   * array `[{key, title, body, at, date, time, repeat, alert, link}]`.
   * Resolves JSON `{armed, exact}`.
   */
  sync(group: string, entriesJson: string): Promise<string>;
  /** Stops [key] if it's ringing and clears its notification. */
  dismiss(key: string): void;
  /** The key that's ringing now, or ''. */
  getRinging(): Promise<string>;
  /** JSON `{key: nextRingEpochMs}` for every armed alarm. */
  getArmed(): Promise<string>;

  /**
   * The system ringtone picker (alarm sounds). Resolves JSON `{uri, title}`
   * ('' uri = default alarm), or '' when cancelled.
   */
  pickRingtone(currentUri: string): Promise<string>;
  ringtoneTitle(uri: string): Promise<string>;
  /** Plays [uri] for a few seconds at [volume] (0–100). Resolves false if nothing can play. */
  previewRingtone(uri: string, volume: number): Promise<boolean>;
  stopPreview(): void;
  hasVibrator(): Promise<boolean>;

  canScheduleExactAlarms(): Promise<boolean>;
  /** Android 12+: the setting that allows exact alarms. */
  openExactAlarmSettings(): void;
  /** Android 14+: whether the lock-screen alarm screen may be shown. */
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): void;
}

export default TurboModuleRegistry.get<Spec>('Alarms');
