/** The Google account connected for File Management. */
export interface GoogleAccount {
  email: string;
  name: string;
  photo: string | null;
}

export type ConnectFailure =
  | 'cancelled'
  | 'in_progress'
  | 'play_services'
  /** The app isn't registered in Google Cloud (package + SHA-1) — DEVELOPER_ERROR. */
  | 'setup_required'
  | 'failed';

export type ConnectOutcome =
  | { ok: true; account: GoogleAccount }
  | { ok: false; reason: ConnectFailure };

/**
 * Where File Share keeps files: the connected Google account's own Drive
 * (an "Akshar" folder), or the shared Drive set in Settings → File
 * Management (its folder).
 */
export type DriveSource =
  | { kind: 'account'; email: string }
  | { kind: 'shared'; folderId: string };

/** Why a Drive operation failed, as something the UI can explain. */
export type DriveErrorCode =
  | 'not_connected'
  /** The shared Drive's client / refresh token were rejected. */
  | 'shared_auth'
  | 'network'
  /** Drive access wasn't granted (unticked on the consent screen) or was revoked. */
  | 'permission'
  /** The Google Drive API is turned off in the Google Cloud project. */
  | 'api_disabled'
  | 'not_found'
  | 'quota'
  | 'unknown';

export interface DriveFolder {
  id: string;
  name: string;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  /** Bytes; 0 for folders and Google Docs. */
  size: number;
  /** Epoch ms. */
  modifiedAt: number;
  description: string;
  webViewLink: string;
  /** "Anyone with the link" has been granted. */
  shared: boolean;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}
