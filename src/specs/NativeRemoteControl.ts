import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Remote Access module
 * (android/app/src/main/java/com/rnboilerplate/remote/RemoteControlModule.kt).
 *
 * Only the remote feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 *
 * Input is injected only through RemoteControlService, an accessibility
 * service the user turns on in Android's settings (the app never enables
 * it), and only while a session the user allowed is running.
 */
export interface Spec extends TurboModule {
  /** IPv4 addresses of this phone's networks as JSON: [{"address","broadcast"}]. */
  getNetworkAddresses(): Promise<string>;
  /** Wi-Fi multicast lock, so LAN discovery broadcasts are received. */
  setDiscoveryLock(enabled: boolean): void;
  /** The screen in physical pixels as JSON: {"width","height","density","rotation"}. */
  getScreenInfo(): Promise<string>;
  /** Keep this phone's screen on while viewing another device. */
  setKeepScreenOn(enabled: boolean): void;

  /** Is the remote-control accessibility service on? */
  isControlServiceEnabled(): Promise<boolean>;
  /** Opens Android's accessibility settings (the user turns the service on). */
  openControlServiceSettings(): void;
  /**
   * Pointer from the controlling device, 0–1 of the screen.
   * action: "down" | "move" | "up" | "cancel"; button 0 = left.
   */
  pointer(action: string, x: number, y: number, button: number): void;
  /** Wheel / two-finger scroll at (x, y), deltas in the controller's pixels. */
  scroll(x: number, y: number, dx: number, dy: number): void;
  /** back | home | recents | notifications | quickSettings | power | lock | screenshot */
  globalAction(name: string): Promise<boolean>;
  /** Types text into the focused field at the cursor. */
  typeText(text: string): Promise<boolean>;
  /** backspace | delete | enter | selectAll | copy | paste | cut | left | right | home | end */
  editAction(name: string): Promise<boolean>;

  /**
   * Argon2id (RFC 9106), natively: the computer's 64 MiB password check takes
   * about a minute in JavaScript on a phone and well under a second here.
   * password / salt as base64 bytes; resolves the base64 hash (dkLen bytes).
   */
  argon2id(
    password: string,
    salt: string,
    t: number,
    m: number,
    p: number,
    dkLen: number,
  ): Promise<string>;

  /**
   * Saved connection passwords: AES-GCM with a key that lives in the Android
   * Keystore (never leaves it). seal → base64(iv ‖ ciphertext); open reverses
   * it and rejects anything tampered with.
   */
  sealSecret(plain: string): Promise<string>;
  openSecret(sealed: string): Promise<string>;

  /** Heads-up notification for an incoming request while the app is in the background. */
  notifyIncoming(title: string, text: string): void;
  cancelIncoming(): void;
}

export default TurboModuleRegistry.get<Spec>('RemoteControl');
