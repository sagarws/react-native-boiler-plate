import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { storage } from '@/store/mmkv';
import { setDriveClientForTest } from '../repository/drive.repository';
import FileManagementScreen from '../screens/FileManagementScreen';
import type { DriveClient } from '@/services/api';

jest.mock('@react-navigation/native', () => {
  const ReactLib = jest.requireActual('react');
  return {
    useNavigation: () => ({ navigate: mockNavigate }),
    // Run the focus callback once on mount, like a screen gaining focus.
    useFocusEffect: (cb: () => void) => ReactLib.useEffect(cb, [cb]),
  };
});
const mockNavigate = jest.fn();

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getDriveCredentialStatus: jest.fn(),
    getDriveAccessToken: jest.fn(),
    downloadPreviewFile: jest.fn(),
    getPdfPageCount: jest.fn(),
    renderPdfPage: jest.fn(),
    clearPreviewCache: jest.fn(),
    playVideo: jest.fn(),
  },
}));
const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;
const signin = jest.requireMock('@react-native-google-signin/google-signin');

const request = jest.fn();
const readText = jest.fn();
setDriveClientForTest({
  request,
  upload: jest.fn(),
  readText,
  mediaUrl: (id: string) => `https://drive/${id}?alt=media`,
  token: () => Promise.resolve('tok'),
} as unknown as DriveClient);

const notConfigured = JSON.stringify({
  configured: false,
  clientId: '',
  folderId: '',
  secretHint: '',
  tokenHint: '',
});
const sharedConfigured = JSON.stringify({
  configured: true,
  clientId: '123-abc.apps.googleusercontent.com',
  folderId: 'SharedFolder_0123456789',
  secretHint: 'abcd',
  tokenHint: 'wxyz',
});

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render() {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(<FileManagementScreen />);
  });
  mounted.push(r!);
  return r!;
}
const find = (
  r: ReactTestRenderer.ReactTestRenderer,
  id: string,
  prop: string,
) => r.root.findAll(n => n.props.testID === id && prop in n.props)[0];
const has = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root
    .findAllByType('Text' as never, { deep: true })
    .flatMap(n => n.children)
    .filter((c): c is string => typeof c === 'string');

beforeEach(() => {
  jest.clearAllMocks();
  request.mockReset();
  storage.clearAll();
  mockNative.getDriveCredentialStatus.mockResolvedValue(notConfigured);
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('File Management', () => {
  it('shows both cards and asks to connect when nothing is set up', async () => {
    const r = await render();
    expect(has(r, 'files-drive-card')).toBe(true);
    expect(has(r, 'files-share-card')).toBe(true);
    expect(has(r, 'files-needs-drive')).toBe(true);
    expect(find(r, 'files-drive-status', 'label').props.label).toBe(
      'Not connected',
    );
  });

  it('uses the shared Drive from Settings when no account is connected', async () => {
    mockNative.getDriveCredentialStatus.mockResolvedValue(sharedConfigured);
    request
      .mockResolvedValueOnce({ files: [] }) // start folder check (list)
      .mockResolvedValueOnce({
        files: [
          {
            id: 'f1',
            name: 'report.pdf',
            mimeType: 'application/pdf',
            size: '1024',
          },
        ],
      });
    const r = await render();
    expect(find(r, 'files-drive-status', 'label').props.label).toBe(
      'Shared Drive',
    );
    expect(texts(r)).toContain('Shared Drive'); // breadcrumb
    expect(texts(r)).toContain('report.pdf');
    expect(has(r, 'files-needs-drive')).toBe(false);
  });

  it('opens Settings → File Management to manage the shared Drive', async () => {
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'files-manage-shared', 'onPress').props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('Settings', { tab: 'files' });
  });

  it('explains when Google sign-in is not registered for this build', async () => {
    signin.GoogleSignin.signIn.mockRejectedValueOnce(
      Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' }),
    );
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'files-connect', 'onPress').props.onPress();
    });
    expect(find(r, 'files-connect-error', 'message').props.message).toMatch(
      /registered in Google Cloud/,
    );
  });

  it('starts in the personal "Akshar" folder after connecting', async () => {
    signin.GoogleSignin.signIn.mockResolvedValueOnce({
      type: 'success',
      data: {
        user: { email: 'me@x.com', name: 'Me', photo: null },
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    });
    request
      .mockResolvedValueOnce({ files: [{ id: 'akshar-1' }] }) // find Akshar folder
      .mockResolvedValueOnce({ files: [] }); // list it
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'files-connect', 'onPress').props.onPress();
    });
    expect(find(r, 'files-drive-status', 'label').props.label).toBe(
      'Connected',
    );
    expect(texts(r)).toContain('me@x.com');
    expect(texts(r)).toContain('Akshar');
    expect(has(r, 'files-empty')).toBe(true);
  });

  it('asks for Drive access when the checkbox was left unticked, and offers it again on a 403', async () => {
    signin.GoogleSignin.signIn.mockResolvedValueOnce({
      type: 'success',
      data: {
        user: { email: 'me@x.com', name: 'Me', photo: null },
        scopes: ['email'],
      },
    });
    const { ApiError } = jest.requireActual('@/services/api/errors');
    request.mockRejectedValueOnce(
      new ApiError('x', {
        status: 403,
        url: '',
        body: {
          error: { message: 'Request had insufficient authentication scopes.' },
        },
      }),
    );
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'files-connect', 'onPress').props.onPress();
    });
    // Sign-in noticed the missing scope and asked for it.
    expect(signin.GoogleSignin.addScopes).toHaveBeenCalledWith({
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    // Still refused: the error shows Google's reason and a way to grant access.
    expect(find(r, 'files-load-error', 'message').props.message).toMatch(
      /Google says: Request had insufficient authentication scopes\./,
    );
    signin.GoogleSignin.addScopes.mockResolvedValueOnce({
      type: 'success',
      data: {
        user: { email: 'me@x.com', name: 'Me', photo: null },
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    });
    request
      .mockResolvedValueOnce({ files: [{ id: 'akshar-1' }] })
      .mockResolvedValueOnce({ files: [] });
    await ReactTestRenderer.act(async () => {
      find(r, 'files-grant-access', 'onPress').props.onPress();
    });
    expect(has(r, 'files-empty')).toBe(true);
  });

  it('shows thumbnails and previews files full-screen', async () => {
    mockNative.getDriveCredentialStatus.mockResolvedValue(sharedConfigured);
    request.mockResolvedValueOnce({ files: [] }).mockResolvedValueOnce({
      files: [
        {
          id: 'p1',
          name: 'photo.png',
          mimeType: 'image/png',
          thumbnailLink: 'https://lh3.googleusercontent.com/p1=s220',
        },
        { id: 'n1', name: 'notes.txt', mimeType: 'text/plain' },
        { id: 'z1', name: 'backup.zip', mimeType: 'application/zip' },
      ],
    });
    const r = await render();
    expect(find(r, 'file-thumb-p1', 'source').props.source).toEqual({
      uri: 'https://lh3.googleusercontent.com/p1=s160',
    });

    // Image: full resolution with the Drive token.
    await ReactTestRenderer.act(async () => {
      find(r, 'file-open-row-p1', 'onPress').props.onPress();
    });
    expect(find(r, 'preview-image', 'source').props.source).toEqual({
      uri: 'https://drive/p1?alt=media',
      headers: { Authorization: 'Bearer tok' },
    });
    await ReactTestRenderer.act(async () => {
      find(r, 'preview-close', 'onPress').props.onPress();
    });

    // Text: its contents.
    readText.mockResolvedValueOnce('line one');
    await ReactTestRenderer.act(async () => {
      find(r, 'file-open-row-n1', 'onPress').props.onPress();
    });
    expect(find(r, 'preview-text', 'children').props.children).toBe('line one');
    await ReactTestRenderer.act(async () => {
      find(r, 'preview-close', 'onPress').props.onPress();
    });

    // No thumbnail and not text: details + Open in Drive.
    await ReactTestRenderer.act(async () => {
      find(r, 'file-open-row-z1', 'onPress').props.onPress();
    });
    expect(has(r, 'preview-none')).toBe(true);
  });

  it('shows every PDF page and plays videos in the app', async () => {
    mockNative.getDriveCredentialStatus.mockResolvedValue(sharedConfigured);
    request.mockResolvedValueOnce({ files: [] }).mockResolvedValueOnce({
      files: [
        { id: 'd1', name: 'book.pdf', mimeType: 'application/pdf' },
        {
          id: 'v1',
          name: 'clip.mp4',
          mimeType: 'video/mp4',
          thumbnailLink: 'https://lh3.googleusercontent.com/v1=s220',
        },
      ],
    });
    mockNative.downloadPreviewFile.mockResolvedValue(
      '/cache/previews/book.bin',
    );
    mockNative.getPdfPageCount.mockResolvedValue(3);
    mockNative.renderPdfPage.mockImplementation((_p: string, page: number) =>
      Promise.resolve(`file:///cache/page-${page}.jpg`),
    );
    const r = await render();

    await ReactTestRenderer.act(async () => {
      find(r, 'file-open-row-d1', 'onPress').props.onPress();
    });
    // Downloaded with a short-lived token, then paged.
    expect(mockNative.downloadPreviewFile).toHaveBeenCalledWith(
      'https://drive/d1?alt=media',
      'Bearer tok',
    );
    expect(find(r, 'pdf-pages', 'data').props.data).toEqual([0, 1, 2]);
    expect(has(r, 'pdf-page-0')).toBe(true);
    await ReactTestRenderer.act(async () => {
      find(r, 'preview-close', 'onPress').props.onPress();
    });
    expect(mockNative.clearPreviewCache).toHaveBeenCalled();

    await ReactTestRenderer.act(async () => {
      find(r, 'file-open-row-v1', 'onPress').props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      find(r, 'preview-play', 'onPress').props.onPress();
    });
    expect(mockNative.playVideo).toHaveBeenCalledWith(
      'https://drive/v1?alt=media',
      'Bearer tok',
      'clip.mp4',
    );
  });

  it('falls back to the first page when a PDF cannot be opened', async () => {
    mockNative.getDriveCredentialStatus.mockResolvedValue(sharedConfigured);
    request.mockResolvedValueOnce({ files: [] }).mockResolvedValueOnce({
      files: [
        {
          id: 'd2',
          name: 'huge.pdf',
          mimeType: 'application/pdf',
          thumbnailLink: 'https://lh3.googleusercontent.com/d2=s220',
        },
      ],
    });
    mockNative.downloadPreviewFile.mockRejectedValue(
      Object.assign(new Error('too_large'), { code: 'too_large' }),
    );
    const r = await render();
    await ReactTestRenderer.act(async () => {
      find(r, 'file-open-row-d2', 'onPress').props.onPress();
    });
    expect(find(r, 'preview-pdf-failed', 'message').props.message).toMatch(
      /over 100 MB/,
    );
    expect(find(r, 'preview-image', 'source').props.source).toEqual({
      uri: 'https://lh3.googleusercontent.com/d2=s1600',
    });
  });
});
