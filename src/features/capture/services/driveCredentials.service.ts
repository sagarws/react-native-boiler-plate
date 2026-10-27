import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';

/**
 * The shared Google Drive File Management uses when no personal Google
 * account is connected. Stored encrypted natively; JS can write the values
 * and read this status, but never the client secret or refresh token.
 * (Lives in capture/services because only this folder may use the native
 * module.)
 */
export interface DriveCredentialStatus {
  configured: boolean;
  /** Where the active values come from: saved in Settings, the build's .env defaults, or none. */
  source: 'saved' | 'default' | 'none';
  /** The build has .env defaults (whether or not they're in use). */
  hasDefaults: boolean;
  clientId: string;
  folderId: string;
  /** Last four characters, for "…abcd". */
  secretHint: string;
  tokenHint: string;
}

export interface DriveCredentialsInput {
  clientId: string;
  /** Blank keeps the stored value. */
  clientSecret: string;
  /** Blank keeps the stored value. */
  refreshToken: string;
  /** An id or a Drive folder URL. */
  folderId: string;
}

export type DriveTokenError =
  | 'not_configured'
  | 'invalid_token'
  | 'invalid_client'
  | 'no_internet'
  | 'timeout'
  | 'server';

const TOKEN_ERRORS: readonly DriveTokenError[] = [
  'not_configured',
  'invalid_token',
  'invalid_client',
  'no_internet',
  'timeout',
  'server',
];

export const DRIVE_NOT_CONFIGURED: DriveCredentialStatus = {
  configured: false,
  source: 'none',
  hasDefaults: false,
  clientId: '',
  folderId: '',
  secretHint: '',
  tokenHint: '',
};

const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.slice(0, max) : '';

export function parseDriveCredentialStatus(
  json: string,
): DriveCredentialStatus {
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    return {
      configured: r.configured === true,
      source:
        r.source === 'saved' || r.source === 'default' ? r.source : 'none',
      hasDefaults: r.hasDefaults === true,
      clientId: str(r.clientId, 200),
      folderId: str(r.folderId, 200),
      secretHint: str(r.secretHint, 4),
      tokenHint: str(r.tokenHint, 4),
    };
  } catch {
    return DRIVE_NOT_CONFIGURED;
  }
}

/** Thrown by [driveCredentialsService.accessToken]. */
export class DriveTokenUnavailable extends Error {
  readonly code: DriveTokenError;
  constructor(code: DriveTokenError) {
    super(code);
    this.name = 'DriveTokenUnavailable';
    this.code = code;
  }
}

function tokenError(error: unknown): DriveTokenError {
  const code = (error as { code?: unknown } | null)?.code;
  return TOKEN_ERRORS.includes(code as DriveTokenError)
    ? (code as DriveTokenError)
    : 'server';
}

export const driveCredentialsService = {
  async getStatus(): Promise<DriveCredentialStatus> {
    if (!NativeScreenOcr) return DRIVE_NOT_CONFIGURED;
    try {
      return parseDriveCredentialStatus(
        await NativeScreenOcr.getDriveCredentialStatus(),
      );
    } catch (error) {
      logger.error('driveCredentials.getStatus failed', error);
      return DRIVE_NOT_CONFIGURED;
    }
  },

  /** Saves (merging blank secrets with the stored ones). Resolves whether it was valid and saved. */
  async save(input: DriveCredentialsInput): Promise<boolean> {
    if (!NativeScreenOcr) return false;
    try {
      return await NativeScreenOcr.setDriveCredentials(
        JSON.stringify({
          clientId: input.clientId.trim(),
          clientSecret: input.clientSecret.trim(),
          refreshToken: input.refreshToken.trim(),
          folderId: input.folderId.trim(),
        }),
      );
    } catch {
      // Never log the input: it holds secrets.
      return false;
    }
  },

  /** Forgets saved values and stops using the build defaults. */
  clear(): void {
    NativeScreenOcr?.clearDriveCredentials();
  },

  /** Forgets saved values and goes back to the build's default configuration. */
  restoreDefaults(): void {
    NativeScreenOcr?.restoreDriveDefaults();
  },

  /** A short-lived access token for the shared Drive. */
  async accessToken(forceRefresh: boolean): Promise<string> {
    if (!NativeScreenOcr) throw new DriveTokenUnavailable('not_configured');
    try {
      return await NativeScreenOcr.getDriveAccessToken(forceRefresh);
    } catch (error) {
      throw new DriveTokenUnavailable(tokenError(error));
    }
  },
};
