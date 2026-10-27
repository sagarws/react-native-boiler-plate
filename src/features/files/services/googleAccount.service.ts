import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { logger } from '@/shared/utils';
import type { ConnectOutcome, GoogleAccount } from '../types';

/** Only files this app creates — the rest of the user's Drive stays invisible. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Android reports a missing/mismatched Google Cloud registration as code 10. */
const DEVELOPER_ERROR = '10';

let configured = false;
let lastToken: string | null = null;

function configure() {
  if (configured) return;
  GoogleSignin.configure({ scopes: [DRIVE_SCOPE] });
  configured = true;
}

function toAccount(user: {
  email: string;
  name: string | null;
  photo: string | null;
}): GoogleAccount {
  return {
    email: user.email,
    name: user.name || user.email,
    photo: user.photo,
  };
}

/**
 * The user's own Google account, signed in on the phone (no server). Tokens
 * stay inside Google Play services; this only ever hands out short-lived
 * access tokens to the Drive client, and never logs them.
 */
export const googleAccountService = {
  /** The account signed in this session, if any (no network). */
  current(): GoogleAccount | null {
    configure();
    const user = GoogleSignin.getCurrentUser()?.user;
    return user ? toAccount(user) : null;
  },

  /** Restores a previous sign-in silently (app start). */
  async restore(): Promise<GoogleAccount | null> {
    configure();
    if (!GoogleSignin.hasPreviousSignIn()) return null;
    try {
      const response = await GoogleSignin.signInSilently();
      return response.type === 'success' ? toAccount(response.data.user) : null;
    } catch (error) {
      logger.warn('googleAccount.restore failed', error);
      return null;
    }
  },

  /** Google's account picker + consent for Drive file access. */
  async connect(): Promise<ConnectOutcome> {
    configure();
    try {
      await GoogleSignin.hasPlayServices({
        showPlayServicesUpdateDialog: true,
      });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response))
        return { ok: false, reason: 'cancelled' };
      // Google's consent screen lets people untick Drive access; ask again
      // straight away rather than failing on the first Drive call.
      if (!response.data.scopes.includes(DRIVE_SCOPE)) {
        await googleAccountService.grantDriveAccess();
      }
      return { ok: true, account: toAccount(response.data.user) };
    } catch (error) {
      if (isErrorWithCode(error)) {
        switch (error.code) {
          case statusCodes.SIGN_IN_CANCELLED:
            return { ok: false, reason: 'cancelled' };
          case statusCodes.IN_PROGRESS:
            return { ok: false, reason: 'in_progress' };
          case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            return { ok: false, reason: 'play_services' };
          case DEVELOPER_ERROR:
            return { ok: false, reason: 'setup_required' };
        }
      }
      logger.error('googleAccount.connect failed', error);
      return { ok: false, reason: 'failed' };
    }
  },

  /** Whether the signed-in account has granted Drive file access. */
  hasDriveAccess(): boolean {
    configure();
    return GoogleSignin.getCurrentUser()?.scopes.includes(DRIVE_SCOPE) === true;
  },

  /**
   * Shows Google's consent for Drive file access only (no re-sign-in).
   * Resolves whether access is now granted.
   */
  async grantDriveAccess(): Promise<boolean> {
    configure();
    try {
      const response = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
      lastToken = null;
      return (
        response?.type === 'success' &&
        response.data.scopes.includes(DRIVE_SCOPE)
      );
    } catch (error) {
      logger.warn('googleAccount.grantDriveAccess failed', error);
      return false;
    }
  },

  /**
   * Removes the app's access (revoke) and signs out. Files already in Drive
   * stay there.
   */
  async disconnect(): Promise<void> {
    configure();
    try {
      await GoogleSignin.revokeAccess();
    } catch (error) {
      // Already revoked elsewhere: signing out still clears this phone.
      logger.warn('googleAccount.revokeAccess failed', error);
    }
    try {
      await GoogleSignin.signOut();
    } catch (error) {
      logger.error('googleAccount.signOut failed', error);
    }
    lastToken = null;
  },

  /**
   * A Drive access token. `refresh` drops the cached one first (Drive
   * rejected it), so Play services mints a new one.
   */
  async accessToken(refresh: boolean): Promise<string> {
    configure();
    if (refresh && lastToken) {
      await GoogleSignin.clearCachedAccessToken(lastToken).catch(() => null);
    }
    const { accessToken } = await GoogleSignin.getTokens();
    lastToken = accessToken;
    return accessToken;
  },
};
