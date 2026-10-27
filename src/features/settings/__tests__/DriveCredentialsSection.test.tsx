import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { parseDriveCredentialStatus } from '@/features/capture';
import { DriveCredentialsSection } from '../components/DriveCredentialsSection';

jest.mock('@/specs/NativeScreenOcr', () => ({
  __esModule: true,
  default: {
    getDriveCredentialStatus: jest.fn(),
    setDriveCredentials: jest.fn(),
    clearDriveCredentials: jest.fn(),
    restoreDriveDefaults: jest.fn(),
    getDriveAccessToken: jest.fn(),
  },
}));
const mockNative: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeScreenOcr',
).default;

// Made-up values in the right shapes — never real credentials.
const CLIENT_ID = '1234567890-abcdef.apps.googleusercontent.com';
const SECRET = 'TEST-secret-0000';
const TOKEN = '1//test-refresh-token-000000';

const status = (configured: boolean) =>
  JSON.stringify({
    configured,
    clientId: configured ? CLIENT_ID : '',
    folderId: configured ? 'TestFolder_0123456789' : '',
    secretHint: configured ? '0000' : '',
    tokenHint: configured ? '0000' : '',
  });

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
async function render() {
  let r: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(
      <DriveCredentialsSection expanded onToggle={() => undefined} />,
    );
  });
  mounted.push(r!);
  return r!;
}
const find = (
  r: ReactTestRenderer.ReactTestRenderer,
  id: string,
  prop: string,
) => r.root.findAll(n => n.props.testID === id && prop in n.props)[0];
const act = async (fn: () => void) => {
  await ReactTestRenderer.act(async () => {
    fn();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNative.getDriveCredentialStatus.mockResolvedValue(status(false));
});

afterEach(async () => {
  await ReactTestRenderer.act(() => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('Settings → File Management → Shared Google Drive', () => {
  it('saves all four values to native storage and clears the secrets from the form', async () => {
    mockNative.setDriveCredentials.mockResolvedValue(true);
    const r = await render();
    await act(() =>
      find(r, 'drive-creds-client-id', 'onChangeText').props.onChangeText(
        CLIENT_ID,
      ),
    );
    await act(() =>
      find(r, 'drive-creds-secret', 'onChangeText').props.onChangeText(SECRET),
    );
    await act(() =>
      find(r, 'drive-creds-token', 'onChangeText').props.onChangeText(TOKEN),
    );
    await act(() =>
      find(r, 'drive-creds-folder', 'onChangeText').props.onChangeText(
        'https://drive.google.com/drive/folders/TestFolder_0123456789',
      ),
    );
    mockNative.getDriveCredentialStatus.mockResolvedValue(status(true));
    await act(() => find(r, 'drive-creds-save', 'onPress').props.onPress());

    expect(JSON.parse(mockNative.setDriveCredentials.mock.calls[0][0])).toEqual(
      {
        clientId: CLIENT_ID,
        clientSecret: SECRET,
        refreshToken: TOKEN,
        folderId:
          'https://drive.google.com/drive/folders/TestFolder_0123456789',
      },
    );
    expect(find(r, 'drive-creds-secret', 'value').props.value).toBe('');
    expect(find(r, 'drive-creds-token', 'value').props.value).toBe('');
    expect(
      find(r, 'drive-creds-secret', 'secureTextEntry').props.secureTextEntry,
    ).toBe(true);
    expect(JSON.stringify(r.toJSON())).not.toContain(SECRET);
    expect(find(r, 'drive-creds-message', 'message').props.message).toMatch(
      /^Saved/,
    );
  });

  it('shows saved values as hints and lets one value change', async () => {
    mockNative.getDriveCredentialStatus.mockResolvedValue(status(true));
    mockNative.setDriveCredentials.mockResolvedValue(true);
    const r = await render();
    expect(find(r, 'drive-creds-client-id', 'value').props.value).toBe(
      CLIENT_ID,
    );
    expect(JSON.stringify(r.toJSON())).toContain(
      'Saved (…0000). Leave blank to keep it.',
    );
    await act(() =>
      find(r, 'drive-creds-folder', 'onChangeText').props.onChangeText(
        'Other_0123456789',
      ),
    );
    await act(() => find(r, 'drive-creds-save', 'onPress').props.onPress());
    // Blank secret fields are sent blank: native keeps the stored ones.
    expect(
      JSON.parse(mockNative.setDriveCredentials.mock.calls[0][0]),
    ).toMatchObject({
      clientSecret: '',
      refreshToken: '',
      folderId: 'Other_0123456789',
    });
  });

  it('reports invalid values instead of saving', async () => {
    mockNative.setDriveCredentials.mockResolvedValue(false);
    const r = await render();
    await act(() =>
      find(r, 'drive-creds-client-id', 'onChangeText').props.onChangeText(
        'nope',
      ),
    );
    await act(() =>
      find(r, 'drive-creds-folder', 'onChangeText').props.onChangeText('x'),
    );
    await act(() => find(r, 'drive-creds-save', 'onPress').props.onPress());
    expect(find(r, 'drive-creds-message', 'message').props.message).toMatch(
      /^Not saved/,
    );
  });

  it('says when the build default is in use, and restores it after removal', async () => {
    mockNative.getDriveCredentialStatus.mockResolvedValue(
      JSON.stringify({
        configured: true,
        source: 'default',
        hasDefaults: true,
        clientId: CLIENT_ID,
        folderId: 'Def_0123456789',
        secretHint: '0000',
        tokenHint: '0000',
      }),
    );
    let r = await render();
    expect(find(r, 'drive-creds-default', 'message').props.message).toMatch(
      /default configuration/,
    );
    expect(
      r.root.findAll(n => n.props.testID === 'drive-creds-restore').length,
    ).toBe(0);

    mockNative.getDriveCredentialStatus.mockResolvedValue(
      JSON.stringify({
        configured: false,
        source: 'none',
        hasDefaults: true,
        clientId: '',
        folderId: '',
        secretHint: '',
        tokenHint: '',
      }),
    );
    r = await render();
    await act(() => find(r, 'drive-creds-restore', 'onPress').props.onPress());
    expect(mockNative.restoreDriveDefaults).toHaveBeenCalled();
  });

  it('parses the native status defensively', () => {
    expect(parseDriveCredentialStatus('garbage').configured).toBe(false);
    expect(
      parseDriveCredentialStatus(
        JSON.stringify({ configured: true, secretHint: 'abcdefgh' }),
      ).secretHint,
    ).toBe('abcd');
  });
});
