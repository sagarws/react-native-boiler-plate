import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Share Live Camera module
 * (android/app/src/main/java/com/rnboilerplate/livecamera/LiveCameraModule.kt).
 *
 * Only the live-camera feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 * The camera itself is captured and streamed by react-native-webrtc; native
 * only keeps the app alive in the background (foreground service, wake and
 * Wi-Fi locks), shows the notification and reports network changes.
 *
 * Event (DeviceEventEmitter): `LiveCameraEvent` {type, body: JSON} —
 * stop {} (Stop tapped in the notification, or Android's time limit) |
 * network {online, transport} (same JSON as getNetworkState).
 */
export interface Spec extends TurboModule {
  /**
   * Starts the foreground service (call while the app is in the foreground).
   * Rejects `permission` without CAMERA (or RECORD_AUDIO when withAudio),
   * `start_failed` when Android refuses the foreground service.
   */
  startService(title: string, withAudio: boolean): Promise<void>;
  /** Replaces the notification text, e.g. "Live · 3 viewers · 12:04". No-op when not running. */
  updateNotification(text: string): void;
  /** Stops the service and releases its locks; safe to call when not running. */
  stopService(): void;
  isServiceRunning(): Promise<boolean>;
  /** PNG data URI ("data:image/png;base64,…") of a QR code, size × size pixels. */
  qrCode(text: string, size: number): Promise<string>;
  /** JSON {online, transport: "wifi" | "cellular" | "ethernet" | "other" | "none"}. */
  getNetworkState(): Promise<string>;

  // Event-emitter stubs required by NativeEventEmitter.
  /** Copies text to the clipboard (the viewer link). */
  copyText(text: string): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('LiveCamera');
