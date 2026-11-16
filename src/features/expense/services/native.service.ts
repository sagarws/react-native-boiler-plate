import NativeExpense from '@/specs/NativeExpense';
import { logger } from '@/shared/utils';

export interface UpiApp {
  packageName: string;
  label: string;
  /** PNG data URI; '' when the app has no icon to show. */
  icon: string;
}

export interface UpiLaunchResult {
  /** 'ok' = the UPI app returned a result; 'cancelled' = it didn't say. */
  result: 'ok' | 'cancelled';
  /** The UPI app's own report — a hint only. Never stored or logged. */
  response: string;
}

/** A failed native call: a known code (e.g. no_app) or 'unavailable'. */
export class ExpenseNativeError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const errorCode = (error: unknown) =>
  (error as { code?: string })?.code || (error as Error)?.message || 'failed';

function isApp(value: unknown): value is UpiApp {
  const v = value as Record<string, unknown>;
  return (
    typeof v?.packageName === 'string' &&
    !!v.packageName &&
    typeof v.label === 'string'
  );
}

/**
 * Expense Tracker's bridge to Android's UPI intent handling. Payment links
 * and UPI app responses are never logged — only error codes.
 */
export const upiNative = {
  available: (): boolean => NativeExpense != null,

  /** Installed UPI apps for [uri]; [] when none (or off Android). */
  async apps(uri: string): Promise<UpiApp[]> {
    if (!NativeExpense) return [];
    try {
      const parsed: unknown = JSON.parse(await NativeExpense.getUpiApps(uri));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isApp).map(app => ({
        packageName: app.packageName,
        label: app.label || app.packageName,
        icon:
          typeof app.icon === 'string' && app.icon.startsWith('data:image/')
            ? app.icon
            : '',
      }));
    } catch (error) {
      logger.warn('UPI apps could not be listed', errorCode(error));
      return [];
    }
  },

  /**
   * Opens [uri] in [packageName] — or, when packageName is null, in the app
   * the user picks from Android's chooser (titled [chooserTitle]). Resolves
   * when the user comes back.
   */
  async launch(
    uri: string,
    packageName: string | null,
    chooserTitle = '',
  ): Promise<UpiLaunchResult> {
    if (!NativeExpense) throw new ExpenseNativeError('unavailable');
    try {
      const raw = packageName
        ? await NativeExpense.launchUpiApp(uri, packageName)
        : await NativeExpense.launchUpiChooser(uri, chooserTitle);
      const parsed = JSON.parse(raw) as Partial<UpiLaunchResult>;
      return {
        result: parsed.result === 'ok' ? 'ok' : 'cancelled',
        response: typeof parsed.response === 'string' ? parsed.response : '',
      };
    } catch (error) {
      if (error instanceof SyntaxError)
        return { result: 'cancelled', response: '' };
      logger.warn('UPI app could not be opened', errorCode(error));
      throw new ExpenseNativeError(errorCode(error));
    }
  },

  /**
   * Photo picker → the QR text in the chosen image; null when cancelled.
   * Throws `no_qr` / `image_failed` / `unavailable`. The QR text isn't logged.
   */
  async pickQrImage(): Promise<string | null> {
    if (!NativeExpense) throw new ExpenseNativeError('unavailable');
    try {
      return (await NativeExpense.pickQrImage()) || null;
    } catch (error) {
      logger.warn('QR image could not be read', errorCode(error));
      throw new ExpenseNativeError(errorCode(error));
    }
  },

  /** Opens a UPI app's home screen, to pay by scanning in that app. */
  async openApp(packageName: string): Promise<void> {
    if (!NativeExpense) throw new ExpenseNativeError('unavailable');
    try {
      await NativeExpense.openUpiApp(packageName);
    } catch (error) {
      logger.warn('UPI app could not be opened', errorCode(error));
      throw new ExpenseNativeError(errorCode(error));
    }
  },
};
