import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for Utility → Scanner gun
 * (android/app/src/main/java/com/rnboilerplate/utility/ScanKeyboardModule.kt).
 *
 * Only the utility feature's service layer may import this file. Android 9+
 * only; absent on iOS and under Jest.
 *
 * The phone acts as a Bluetooth keyboard (HID device profile) for a paired
 * computer, and the scanner types each code where the cursor is (US layout).
 *
 * Status JSON (getStatus, and `ScanKeyboardStatus` {body}):
 * { state: 'unsupported'|'permission'|'bluetooth_off'|'stopped'|'starting'|
 *          'ready'|'connecting'|'connected',
 *   host?: {name, address}, connecting?: address, phoneName?: string }
 */
export interface Spec extends TurboModule {
  getStatus(): Promise<string>;
  /** Registers the keyboard (reconnects to the last computer). Resolves the state. */
  start(): Promise<string>;
  /** Disconnects and removes the keyboard. */
  stop(): void;
  /** JSON [{name, address, computer, connected, last}] of paired devices. */
  getHosts(): Promise<string>;
  connect(address: string): Promise<boolean>;
  disconnect(): void;
  /** Asks Android to make the phone visible for 2 minutes (to pair a new computer). */
  makeDiscoverable(): void;
  openBluetoothSettings(): void;
  /**
   * Types text on the connected computer. Resolves the number of characters
   * that could not be typed; rejects 'not_connected'.
   */
  typeText(text: string): Promise<number>;
  /**
   * Opens the camera in gun mode (continuous; each code typed + beep).
   * options: {suffix: '\n'|'\t'|'', beep, vibrate, labels}. Resolves a JSON
   * array of {value, format, typed} when closed.
   */
  startScanGun(optionsJson: string): Promise<string>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.get<Spec>('ScanKeyboard');
