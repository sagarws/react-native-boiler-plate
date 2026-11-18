import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec for the Network Inspector module
 * (android/app/src/main/java/com/rnboilerplate/netinspector/NetInspectorModule.kt).
 *
 * Only the network feature's service layer may import this file. Android
 * only: on iOS (and under Jest) the module is absent and `get` returns null.
 *
 * Captured requests and responses passed through here are never logged.
 */
export interface Spec extends TurboModule {
  /**
   * Registers [script] as a document-start script on the WebView rendered
   * by the view with [viewTag], restricted by Chromium to the origin rules
   * in [originRulesJson] (a JSON array such as
   * `["https://seller.example.com","https://*.example.com"]`). Replaces an
   * earlier script on that view. Resolves false when this WebView build
   * lacks document-start scripts (the caller falls back to page-start
   * injection); rejects `no_webview` / `bad_rules`.
   */
  attachCaptureScript(
    viewTag: number,
    script: string,
    originRulesJson: string,
  ): Promise<boolean>;
  /**
   * The WebView cookie store's `Cookie` value for [url] (HttpOnly cookies
   * included), or null when there are none. Used to complete a captured
   * request's headers; never logged.
   */
  getCookies(url: string): Promise<string | null>;
  /** Removes the script registered on [viewTag]; resolves whether one was. */
  detachCaptureScript(viewTag: number): Promise<boolean>;
  /** Copies [text] (marked sensitive, so Android 13+ hides the preview). */
  copyText(text: string): Promise<boolean>;
  /**
   * Writes [content] (UTF-8) to a private cache file and opens the share
   * sheet for it. Resolves false when nothing can receive it.
   */
  shareTextFile(
    fileName: string,
    mimeType: string,
    content: string,
  ): Promise<boolean>;
  /**
   * "Save to…" (system picker), then writes [content] as UTF-8. Resolves
   * true when written, false when cancelled.
   */
  saveTextDocument(
    fileName: string,
    mimeType: string,
    content: string,
  ): Promise<boolean>;
}

export default TurboModuleRegistry.get<Spec>('NetInspector');
