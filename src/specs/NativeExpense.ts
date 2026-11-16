import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Expense Tracker's UPI module
 * (android/app/src/main/java/com/rnboilerplate/expense/ExpenseModule.kt).
 *
 * Only the expense feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 *
 * The app never talks to a bank or gateway: it only hands a `upi://pay` link
 * to a UPI app the user picks. Whether money moved is confirmed by the user.
 */
export interface Spec extends TurboModule {
  /**
   * UPI apps that can open [uri] (a `upi://pay?…` link), as a JSON array of
   * {packageName, label, icon} where icon is a PNG data URI (or '').
   */
  getUpiApps(uri: string): Promise<string>;
  /**
   * Opens [uri] in [packageName] and resolves when the user comes back, as
   * JSON {result: 'ok' | 'cancelled', response}. `response` is whatever the
   * UPI app chose to report — a hint only, never proof of payment. Rejects
   * `invalid_uri` / `no_app` / `no_activity` / `launch_failed`.
   */
  launchUpiApp(uri: string, packageName: string): Promise<string>;
  /**
   * Same as launchUpiApp, but lets Android's own chooser (titled [title])
   * pick the UPI app — works even when the app list can't be read.
   */
  launchUpiChooser(uri: string, title: string): Promise<string>;
  /**
   * Opens the system photo picker (no storage permission needed) and reads
   * the first QR code in the chosen image, on the device. Resolves its text,
   * or '' when the user cancelled. Rejects `no_qr` / `image_failed` /
   * `no_activity`.
   */
  pickQrImage(): Promise<string>;
  /**
   * Opens a UPI app's own home screen (to pay by scanning there). Only apps
   * Android lists as UPI handlers. Rejects `no_app` / `no_activity`.
   */
  openUpiApp(packageName: string): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('Expense');
