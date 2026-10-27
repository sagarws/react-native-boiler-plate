import { ApiError, NetworkError, type DriveClient } from '@/services/api';
import { storage, StorageKeys } from '@/store/mmkv';
import { DriveTokenUnavailable } from '@/features/capture';
import {
  driveRepository,
  quote,
  setDriveClientForTest,
  toDriveError,
  toItem,
} from '../repository/drive.repository';
import { fileKind, formatSize, formatWhen } from '../utils/format';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: null,
}));

const request = jest.fn();
const upload = jest.fn();
setDriveClientForTest({ request, upload } as unknown as DriveClient);

beforeEach(() => {
  request.mockReset();
  upload.mockReset();
  storage.clearAll();
});

const notFound = () => new ApiError('nope', { status: 404, url: 'x' });

describe('start folder', () => {
  it('creates the "Akshar" folder in a personal Drive once, then reuses it', async () => {
    request
      .mockResolvedValueOnce({ files: [] }) // search: none
      .mockResolvedValueOnce({ id: 'root-1' }); // create
    await expect(
      driveRepository.startFolder({ kind: 'account', email: 'a@x.com' }),
    ).resolves.toBe('root-1');
    expect(request.mock.calls[1][0]).toMatchObject({
      method: 'POST',
      body: {
        name: 'Akshar',
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['root'],
      },
    });
    expect(
      JSON.parse(storage.getString(StorageKeys.DriveRootFolders)!),
    ).toEqual({ 'a@x.com': 'root-1' });

    request.mockReset().mockResolvedValueOnce({ id: 'root-1', trashed: false });
    await expect(
      driveRepository.startFolder({ kind: 'account', email: 'a@x.com' }),
    ).resolves.toBe('root-1');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('finds the folder again when the cached one was deleted', async () => {
    storage.set(
      StorageKeys.DriveRootFolders,
      JSON.stringify({ 'a@x.com': 'gone' }),
    );
    request
      .mockRejectedValueOnce(notFound())
      .mockResolvedValueOnce({ files: [{ id: 'found-2' }] });
    await expect(driveRepository.rootFolder('a@x.com')).resolves.toBe(
      'found-2',
    );
  });

  it('uses the configured folder for the shared Drive', async () => {
    request.mockResolvedValueOnce({ files: [] });
    await expect(
      driveRepository.startFolder({
        kind: 'shared',
        folderId: 'shared-folder',
      }),
    ).resolves.toBe('shared-folder');
    // Reachability is checked by listing: drive.file hides the folder itself.
    expect(request.mock.calls[0][0]).toMatchObject({
      path: '/files',
      query: { q: "'shared-folder' in parents and trashed = false" },
    });
  });
});

describe('files', () => {
  it('lists a folder and maps Drive files', async () => {
    request.mockResolvedValueOnce({
      files: [
        {
          id: 'f1',
          name: 'Docs',
          mimeType: 'application/vnd.google-apps.folder',
        },
        {
          id: 'f2',
          name: 'scan.pdf',
          mimeType: 'application/pdf',
          size: '2048',
          modifiedTime: '2026-10-01T10:00:00Z',
          description: 'old book',
          webViewLink: 'https://drive.google.com/file/d/f2/view',
          shared: true,
        },
      ],
    });
    const items = await driveRepository.list("it's");
    expect(request.mock.calls[0][0].query.q).toBe(
      "'it\\'s' in parents and trashed = false",
    );
    expect(items[0]).toMatchObject({ isFolder: true, name: 'Docs', size: 0 });
    expect(items[1]).toMatchObject({
      isFolder: false,
      size: 2048,
      description: 'old book',
      shared: true,
    });
  });

  it('shares with anyone-with-link and returns the link', async () => {
    request
      .mockResolvedValueOnce({ id: 'perm' })
      .mockResolvedValueOnce({ webViewLink: 'https://link' });
    await expect(driveRepository.share('f2')).resolves.toBe('https://link');
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'POST',
      path: '/files/f2/permissions',
      body: { type: 'anyone', role: 'reader' },
    });
  });

  it('deletes by moving to the Drive trash (recoverable)', async () => {
    request.mockResolvedValueOnce({ id: 'f2' });
    await driveRepository.trash('f2');
    expect(request.mock.calls[0][0]).toMatchObject({
      method: 'PATCH',
      body: { trashed: true },
    });
  });
});

describe('errors the UI can explain', () => {
  it('maps HTTP, network and shared-token failures', () => {
    expect(toDriveError(new ApiError('x', { status: 401, url: '' })).code).toBe(
      'not_connected',
    );
    expect(
      toDriveError(
        new ApiError('x', {
          status: 403,
          url: '',
          body: { error: { message: 'insufficient' } },
        }),
      ).code,
    ).toBe('permission');
    expect(
      toDriveError(
        new ApiError('x', {
          status: 403,
          url: '',
          body: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } },
        }),
      ).code,
    ).toBe('quota');
    expect(toDriveError(notFound()).code).toBe('not_found');
    expect(toDriveError(new NetworkError('down', '')).code).toBe('network');
    expect(toDriveError(new DriveTokenUnavailable('invalid_token')).code).toBe(
      'shared_auth',
    );
    expect(toDriveError(new DriveTokenUnavailable('no_internet')).code).toBe(
      'network',
    );
  });

  it('tells a disabled Drive API apart from missing permission, keeping Google’s message', () => {
    const disabled = toDriveError(
      new ApiError('x', {
        status: 403,
        url: '',
        body: {
          error: {
            message:
              'Google Drive API has not been used in project 123 before or it is disabled.',
            errors: [{ reason: 'accessNotConfigured' }],
          },
        },
      }),
    );
    expect(disabled.code).toBe('api_disabled');
    expect(disabled.detail).toMatch(/has not been used/);

    const scope = toDriveError(
      new ApiError('x', {
        status: 403,
        url: '',
        body: {
          error: {
            message: 'Request had insufficient authentication scopes.',
            status: 'PERMISSION_DENIED',
          },
        },
      }),
    );
    expect(scope.code).toBe('permission');
    expect(scope.detail).toBe(
      'Request had insufficient authentication scopes.',
    );
  });

  it('escapes Drive query literals', () => {
    expect(quote("a'b\\c")).toBe("'a\\'b\\\\c'");
  });

  it('treats Google Docs (no size) as size 0', () => {
    expect(
      toItem({
        id: 'd',
        name: 'Doc',
        mimeType: 'application/vnd.google-apps.document',
      }).size,
    ).toBe(0);
  });
});

describe('formatting', () => {
  it('formats sizes, dates and kinds', () => {
    expect(formatSize(0)).toBe('');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatWhen(0)).toBe('');
    const now = new Date('2026-10-27T12:00:00');
    expect(
      formatWhen(new Date('2026-10-27T09:30:00').getTime(), now),
    ).not.toContain('·');
    expect(
      formatWhen(new Date('2026-10-01T09:30:00').getTime(), now),
    ).toContain('·');
    expect(fileKind('image/png', 'a.png')).toBe('image');
    expect(fileKind('application/octet-stream', 'sheet.xlsx')).toBe('doc');
  });
});
