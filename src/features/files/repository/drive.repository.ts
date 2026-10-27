import {
  ApiError,
  createDriveClient,
  DRIVE_FILE_FIELDS,
  FOLDER_MIME,
  NetworkError,
  type DriveClient,
  type DriveFile,
} from '@/services/api';
import { storage, StorageKeys } from '@/store/mmkv';
import {
  DriveTokenUnavailable,
  driveCredentialsService,
} from '@/features/capture';
import { googleAccountService } from '../services/googleAccount.service';
import type {
  DriveErrorCode,
  DriveItem,
  DriveSource,
  PickedFile,
} from '../types';

/** The folder created in the user's Drive to hold everything uploaded from Akshar. */
export const ROOT_FOLDER_NAME = 'Akshar';

/** A Drive failure the UI can explain. */
export class DriveError extends Error {
  readonly code: DriveErrorCode;
  /** Google's own explanation (shown under the friendly message), or ''. */
  readonly detail: string;
  constructor(code: DriveErrorCode, detail = '') {
    super(detail || code);
    this.name = 'DriveError';
    this.code = code;
    this.detail = detail;
  }
}

/** Google's error message and reason codes from an error body. */
function googleError(body: unknown): { message: string; reasons: string } {
  const err = (body as { error?: Record<string, unknown> } | undefined)?.error;
  const message = typeof err?.message === 'string' ? err.message : '';
  // Reasons appear in errors[].reason (v3) and details[].reason (newer APIs).
  const reasons = JSON.stringify([err?.status, err?.errors, err?.details]);
  return { message: message.slice(0, 300), reasons };
}

export function toDriveError(error: unknown): DriveError {
  if (error instanceof DriveError) return error;
  if (error instanceof DriveTokenUnavailable) {
    if (error.code === 'no_internet' || error.code === 'timeout')
      return new DriveError('network');
    if (error.code === 'server') return new DriveError('unknown');
    return new DriveError('shared_auth');
  }
  if (error instanceof NetworkError) return new DriveError('network');
  if (error instanceof ApiError) {
    const { message, reasons } = googleError(error.body);
    const is = (re: RegExp) => re.test(reasons) || re.test(message);
    if (error.status === 401) return new DriveError('not_connected', message);
    if (error.status === 404) return new DriveError('not_found', message);
    if (error.status === 429) return new DriveError('quota', message);
    if (error.status === 403) {
      if (
        is(
          /accessNotConfigured|SERVICE_DISABLED|has not been used|is disabled/i,
        )
      ) {
        return new DriveError('api_disabled', message);
      }
      if (is(/quota|rateLimit|storageQuota/i))
        return new DriveError('quota', message);
      return new DriveError('permission', message);
    }
    return new DriveError('unknown', message);
  }
  if (
    error instanceof Error &&
    /SIGN_IN_REQUIRED|getTokens/i.test(error.message)
  ) {
    return new DriveError('not_connected');
  }
  return new DriveError('unknown');
}

/** Escapes a value for a Drive `q` string literal. */
export function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function toItem(file: DriveFile): DriveItem {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    isFolder: file.mimeType === FOLDER_MIME,
    size: Number(file.size ?? 0) || 0,
    modifiedAt: file.modifiedTime ? Date.parse(file.modifiedTime) || 0 : 0,
    description: file.description ?? '',
    webViewLink: file.webViewLink ?? '',
    shared: file.shared === true,
    thumbnailLink: file.thumbnailLink ?? '',
  };
}

/** One HTTP client per source, each with its own token provider. */
let clients: Record<DriveSource['kind'], DriveClient> = {
  account: createDriveClient(refresh =>
    googleAccountService.accessToken(refresh),
  ),
  shared: createDriveClient(refresh =>
    driveCredentialsService.accessToken(refresh),
  ),
};

/** The source the file browser is showing; set by `use` / `startFolder`. */
let activeKind: DriveSource['kind'] = 'account';
const client = () => clients[activeKind];

/** Tests swap the HTTP client (for both sources). */
export function setDriveClientForTest(next: DriveClient) {
  clients = { account: next, shared: next };
}

function cachedRoots(): Record<string, string> {
  try {
    const raw = storage.getString(StorageKeys.DriveRootFolders);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

function cacheRoot(email: string, id: string | null) {
  const roots = cachedRoots();
  if (id) roots[email] = id;
  else delete roots[email];
  storage.set(StorageKeys.DriveRootFolders, JSON.stringify(roots));
}

async function wrap<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toDriveError(error);
  }
}

/** Drive operations for File Management (Repository layer). */
export const driveRepository = {
  /**
   * The "Akshar" folder in this account's Drive: cached id if it still
   * exists, else an existing one found by name, else a new one.
   */
  /** Selects the Drive later calls use (token source). */
  use(source: DriveSource) {
    activeKind = source.kind;
  },

  /**
   * The folder File Share starts in: for the shared Drive, its configured
   * folder (checked to be reachable); for an account, its "Akshar" folder.
   */
  startFolder(source: DriveSource): Promise<string> {
    activeKind = source.kind;
    if (source.kind === 'account')
      return driveRepository.rootFolder(source.email);
    // With the drive.file scope Google hides the shared folder's own metadata
    // (404) while still allowing its contents to be listed and uploaded to —
    // so check reachability by listing, not by reading the folder.
    return wrap(async () => {
      await clients.shared.request({
        path: '/files',
        query: {
          q: `${quote(source.folderId)} in parents and trashed = false`,
          fields: 'files(id)',
          pageSize: 1,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
      });
      return source.folderId;
    });
  },

  /**
   * Settings' "Test connection" for the shared Drive: gets a token from the
   * stored refresh token and lists the folder. Resolves how many items it has.
   */
  checkShared(folderId: string): Promise<number> {
    return wrap(async () => {
      const data = await clients.shared.request<{ files?: { id: string }[] }>({
        path: '/files',
        query: {
          q: `${quote(folderId)} in parents and trashed = false`,
          fields: 'files(id)',
          pageSize: 200,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
      });
      return data.files?.length ?? 0;
    });
  },

  rootFolder(email: string): Promise<string> {
    return wrap(async () => {
      const cached = cachedRoots()[email];
      if (cached) {
        try {
          const f = await client().request<{ id: string; trashed?: boolean }>({
            path: `/files/${encodeURIComponent(cached)}`,
            query: { fields: 'id,trashed' },
          });
          if (!f.trashed) return f.id;
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
        cacheRoot(email, null);
      }
      const found = await client().request<{ files: { id: string }[] }>({
        path: '/files',
        query: {
          q: `name = ${quote(ROOT_FOLDER_NAME)} and mimeType = ${quote(
            FOLDER_MIME,
          )} and 'root' in parents and trashed = false`,
          fields: 'files(id)',
          pageSize: 1,
        },
      });
      const id =
        found.files[0]?.id ??
        (
          await client().request<{ id: string }>({
            method: 'POST',
            path: '/files',
            query: { fields: 'id' },
            body: {
              name: ROOT_FOLDER_NAME,
              mimeType: FOLDER_MIME,
              parents: ['root'],
            },
          })
        ).id;
      cacheRoot(email, id);
      return id;
    });
  },

  /** A folder's contents: subfolders first, then files, newest first. */
  list(folderId: string): Promise<DriveItem[]> {
    return wrap(async () => {
      const data = await client().request<{ files: DriveFile[] }>({
        path: '/files',
        query: {
          q: `${quote(folderId)} in parents and trashed = false`,
          fields: `files(${DRIVE_FILE_FIELDS})`,
          orderBy: 'folder,modifiedTime desc',
          pageSize: 200,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
      });
      return (data.files ?? []).map(toItem);
    });
  },

  createFolder(parentId: string, name: string): Promise<DriveItem> {
    return wrap(async () =>
      toItem(
        await client().request<DriveFile>({
          method: 'POST',
          path: '/files',
          query: { fields: DRIVE_FILE_FIELDS },
          body: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        }),
      ),
    );
  },

  upload(
    folderId: string,
    file: PickedFile,
    description: string,
    onProgress?: (fraction: number) => void,
  ): Promise<DriveItem> {
    return wrap(async () => {
      // React Native's fetch reads content:// and file:// URIs into a Blob.
      const blob = await (await fetch(file.uri)).blob();
      const created = await client().upload(
        {
          name: file.name,
          parents: [folderId],
          ...(description ? { description } : {}),
        },
        blob,
        file.mimeType || 'application/octet-stream',
        onProgress,
      );
      return toItem(created);
    });
  },

  setDescription(id: string, description: string): Promise<DriveItem> {
    return wrap(async () =>
      toItem(
        await client().request<DriveFile>({
          method: 'PATCH',
          path: `/files/${encodeURIComponent(id)}`,
          query: { fields: DRIVE_FILE_FIELDS },
          body: { description },
        }),
      ),
    );
  },

  /** Moves to the Drive trash (recoverable there for 30 days). */
  trash(id: string): Promise<void> {
    return wrap(async () => {
      await client().request({
        method: 'PATCH',
        path: `/files/${encodeURIComponent(id)}`,
        query: { fields: 'id' },
        body: { trashed: true },
      });
    });
  },

  /**
   * What an in-app preview needs for the file's full content: its URL and
   * the Authorization header for the Drive in use.
   */
  mediaSource(
    id: string,
  ): Promise<{ uri: string; headers: Record<string, string> }> {
    return wrap(async () => ({
      uri: client().mediaUrl(id),
      headers: { Authorization: `Bearer ${await client().token()}` },
    }));
  },

  /** The start of a text file, for a preview (at most [maxBytes]). */
  readText(id: string, maxBytes = 64 * 1024): Promise<string> {
    return wrap(() => client().readText(id, maxBytes));
  },

  /** Grants "anyone with the link can view" and returns that link. */
  share(id: string): Promise<string> {
    return wrap(async () => {
      await client().request({
        method: 'POST',
        path: `/files/${encodeURIComponent(id)}/permissions`,
        query: { fields: 'id' },
        body: { type: 'anyone', role: 'reader' },
      });
      const f = await client().request<{ webViewLink?: string }>({
        path: `/files/${encodeURIComponent(id)}`,
        query: { fields: 'webViewLink' },
      });
      if (!f.webViewLink)
        throw new DriveError('unknown', 'No share link returned');
      return f.webViewLink;
    });
  },
};
