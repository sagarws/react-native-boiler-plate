import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Follow Up module
 * (android/app/src/main/java/com/rnboilerplate/followup/FollowUpModule.kt).
 *
 * Only the followup feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 */
export interface Spec extends TurboModule {
  /**
   * Replaces every scheduled reminder with the JSON array
   * `[{key, at, title, body, contactId}]` (at = epoch ms). Resolves how many
   * were scheduled, or -1 when the app's notifications are blocked.
   */
  syncReminders(remindersJson: string): Promise<number>;
  /**
   * Asks the user where to save (system "Save to" screen), then writes
   * [content]. Resolves true when written, false when cancelled.
   */
  saveTextDocument(
    fileName: string,
    mimeType: string,
    content: string,
  ): Promise<boolean>;
  /** Opens a private attachment (file:// in app storage) in a viewer app. */
  openAttachment(uri: string, mimeType: string): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('FollowUp');
