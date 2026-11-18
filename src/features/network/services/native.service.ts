import { Platform, Share } from 'react-native';
import NativeNetInspector from '@/specs/NativeNetInspector';
import { logger } from '@/shared/utils';

/**
 * WebViewCaptureBridge + the platform side of copy/export.
 *
 * How the capture script gets into the page:
 * - `documentStart` (Android with a current WebView): Chromium runs it before
 *   any page script, only in frames from the allowed origins.
 * - `userScript` (iOS): a WKUserScript at document start in every frame; the
 *   script itself returns early outside the allowed domains.
 * - `pageStart` (Android WebView without document-start support): injected
 *   when the page starts loading — the earliest requests can be missed.
 *
 * Content passed through here is never logged; only error codes are.
 */
export type InjectionMode = 'documentStart' | 'userScript' | 'pageStart';

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || (error as Error)?.name || 'failed';

export const networkNative = {
  /** Registers the script on the WebView with [viewTag]. */
  async attachScript(
    viewTag: number | null,
    script: string,
    originRules: string[],
  ): Promise<InjectionMode> {
    if (Platform.OS === 'ios') return 'userScript';
    if (!NativeNetInspector || viewTag == null) return 'pageStart';
    try {
      const attached = await NativeNetInspector.attachCaptureScript(
        viewTag,
        script,
        JSON.stringify(originRules),
      );
      return attached ? 'documentStart' : 'pageStart';
    } catch (error) {
      logger.warn(
        'Network Inspector: capture script not attached',
        errorCode(error),
      );
      return 'pageStart';
    }
  },

  /** Reads WebView cookies natively (Android); iOS falls back to the page. */
  canReadCookies: (): boolean => NativeNetInspector != null,

  /** The browser's cookies for [url]; null when none or unreadable. */
  async cookies(url: string): Promise<string | null> {
    if (!NativeNetInspector) return null;
    try {
      return await NativeNetInspector.getCookies(url);
    } catch (error) {
      logger.warn('Network Inspector: cookies not read', errorCode(error));
      return null;
    }
  },

  async detachScript(viewTag: number | null): Promise<void> {
    if (!NativeNetInspector || viewTag == null || Platform.OS === 'ios') return;
    try {
      await NativeNetInspector.detachCaptureScript(viewTag);
    } catch (error) {
      logger.warn(
        'Network Inspector: capture script not detached',
        errorCode(error),
      );
    }
  },

  /**
   * Copies [text]. Without the native module (iOS) the share sheet opens
   * instead, whose "Copy" does the same. Resolves whether it worked.
   */
  async copy(text: string): Promise<boolean> {
    if (NativeNetInspector) {
      try {
        return await NativeNetInspector.copyText(text);
      } catch (error) {
        logger.warn('Network Inspector: copy failed', errorCode(error));
        return false;
      }
    }
    try {
      const result = await Share.share({ message: text });
      return result.action === Share.sharedAction;
    } catch (error) {
      logger.warn('Network Inspector: share failed', errorCode(error));
      return false;
    }
  },

  /** Share sheet with [content] as a .json file (iOS: as text). */
  async shareFile(fileName: string, content: string): Promise<boolean> {
    if (NativeNetInspector) {
      return NativeNetInspector.shareTextFile(
        fileName,
        'application/json',
        content,
      );
    }
    const result = await Share.share({ message: content, title: fileName });
    return result.action === Share.sharedAction;
  },

  /** True where "Save to device" is offered (Android's system picker). */
  canSaveFile: (): boolean => NativeNetInspector != null,

  /** System "Save to…" picker; false when the user cancelled. */
  async saveFile(fileName: string, content: string): Promise<boolean> {
    if (!NativeNetInspector) return false;
    return NativeNetInspector.saveTextDocument(
      fileName,
      'application/json',
      content,
    );
  },
};
