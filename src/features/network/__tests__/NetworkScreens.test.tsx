import React from 'react';
import { Alert } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import { networkStorage, storage } from '@/store/mmkv';
import { networkRepository } from '../repository/network.repository';
import { networkSettingsStore } from '../store/networkSettings.store';
import NetworkBrowserScreen from '../screens/NetworkBrowserScreen';
import NetworkCallDetailScreen from '../screens/NetworkCallDetailScreen';
import NetworkCallsScreen from '../screens/NetworkCallsScreen';
import NetworkInspectorScreen from '../screens/NetworkInspectorScreen';
import { makeRecord } from '../__fixtures__/records';

/** A script URL as hostile input (built so linters don't flag it). */
const HOSTILE_URL = ['javascript', 'alert(1)'].join(':');

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: Record<string, unknown> | undefined;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: mockParams }),
  useIsFocused: () => true,
}));
jest.mock('@/specs/NativeNetInspector', () => ({
  __esModule: true,
  default: {
    attachCaptureScript: jest.fn().mockResolvedValue(true),
    detachCaptureScript: jest.fn().mockResolvedValue(true),
    copyText: jest.fn().mockResolvedValue(true),
    shareTextFile: jest.fn().mockResolvedValue(true),
    saveTextDocument: jest.fn().mockResolvedValue(true),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativeNetInspector',
).default;

type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];
async function render(node: React.ReactElement) {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r!);
  return r!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const byLabel = (r: Renderer, label: string) =>
  r.root.findAll(
    n =>
      n.props.accessibilityLabel === label &&
      typeof n.props.onPress === 'function',
  )[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const text = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.filter(c => typeof c === 'string').join(''))
    .join('\n');
async function act(fn: () => unknown) {
  await ReactTestRenderer.act(async () => {
    await fn();
  });
}
/** Presses the Alert button with [label]. */
function alertButton(label: string) {
  const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
  return (call[2] as { text: string; onPress?: () => void }[]).find(
    b => b.text === label,
  )!;
}

beforeEach(() => {
  storage.clearAll();
  networkStorage.clearAll();
  networkRepository.resetCacheForTest();
  networkSettingsStore.resetCacheForTest();
  mockParams = undefined;
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(() => {
  mounted.splice(0).forEach(r => ReactTestRenderer.act(() => r.unmount()));
  jest.restoreAllMocks();
});

describe('Network Inspector hub', () => {
  it('starts off and turns capture on and off', async () => {
    const r = await render(<NetworkInspectorScreen />);
    expect(text(r)).toContain('Capture off');
    await act(() => byLabel(r, 'Enable Network Capture').props.onPress());
    expect(networkSettingsStore.read()).toMatchObject({
      enabled: true,
      session: 'recording',
    });
    expect(text(r)).toContain('Recording');
    await act(() => byId(r, 'net-controls-pause').props.onPress());
    expect(networkSettingsStore.read().session).toBe('paused');
    await act(() => byLabel(r, 'Enable Network Capture').props.onPress());
    expect(networkSettingsStore.read()).toMatchObject({
      enabled: false,
      session: 'stopped',
    });
  });

  it('adds valid domains and rejects invalid ones', async () => {
    const r = await render(<NetworkInspectorScreen />);
    await act(() =>
      byId(r, 'net-domain-input').props.onChangeText('seller.example.com.'),
    );
    await act(() =>
      byId(r, 'net-domain-input').props.onChangeText('bad domain'),
    );
    await act(() => byId(r, 'net-add-domain').props.onPress());
    expect(text(r)).toContain('Enter a domain such as');
    await act(() =>
      byId(r, 'net-domain-input').props.onChangeText(
        'https://Seller.Example.com/orders',
      ),
    );
    await act(() => byId(r, 'net-add-domain').props.onPress());
    expect(networkSettingsStore.read().domains).toEqual([
      { host: 'seller.example.com', includeSubdomains: false },
    ]);
    expect(text(r)).toContain('seller.example.com only');
    await act(() => byId(r, 'net-remove-seller.example.com').props.onPress());
    expect(networkSettingsStore.read().domains).toEqual([]);
  });

  it('opens a typed address in the browser', async () => {
    const r = await render(<NetworkInspectorScreen />);
    await act(() => byId(r, 'net-address').props.onChangeText(HOSTILE_URL));
    await act(() => byId(r, 'net-open').props.onPress());
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(() =>
      byId(r, 'net-address').props.onChangeText('seller.example.com/orders'),
    );
    await act(() => byId(r, 'net-open').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('NetworkBrowser', {
      url: 'https://seller.example.com/orders',
    });
  });
});

describe('In-app browser', () => {
  it('attaches the recorder before loading the site, and shows the state', async () => {
    networkSettingsStore.setEnabled(true);
    networkSettingsStore.addDomain('seller.example.com', false);
    networkSettingsStore.setSession('stopped');
    mockParams = { url: 'https://seller.example.com/' };
    // The test renderer has no native views; give the host a tag.
    jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(42);
    const r = await render(<NetworkBrowserScreen />);
    // Opening the browser with capture on starts recording.
    expect(networkSettingsStore.read().session).toBe('recording');
    const web = () => byId(r, 'net-webview');
    expect(web().props.source).toHaveProperty('html');
    await act(() => web().props.onLoadEnd());
    expect(native.attachCaptureScript).toHaveBeenCalledWith(
      42,
      expect.stringContaining('__aksharNetInspector'),
      JSON.stringify([
        'https://seller.example.com',
        'http://seller.example.com',
      ]),
    );
    expect(web().props.source).toEqual({ uri: 'https://seller.example.com/' });
    // Chromium injects it; no page-start fallback needed.
    expect(web().props.injectedJavaScriptBeforeContentLoaded).toBeUndefined();
    expect(byId(r, 'net-indicator').props.children).toBe('Recording');
    await act(() =>
      web().props.onNavigationStateChange({
        url: 'https://google.com/',
        canGoBack: true,
        canGoForward: false,
      }),
    );
    expect(byId(r, 'net-indicator').props.children).toMatch(/Not captured/);
  });

  it('falls back to page-start injection, and says so, without document-start support', async () => {
    networkSettingsStore.setEnabled(true);
    networkSettingsStore.addDomain('seller.example.com', false);
    native.attachCaptureScript.mockResolvedValueOnce(false);
    jest.spyOn(require('react-native'), 'findNodeHandle').mockReturnValue(42);
    mockParams = { url: 'https://seller.example.com/' };
    const r = await render(<NetworkBrowserScreen />);
    await act(() => byId(r, 'net-webview').props.onLoadEnd());
    expect(byId(r, 'net-webview').props.source).toEqual({
      uri: 'https://seller.example.com/',
    });
    expect(
      byId(r, 'net-webview').props.injectedJavaScriptBeforeContentLoaded,
    ).toContain('__aksharNetInspector');
    expect(text(r)).toContain('very first requests of each page may be missed');
  });

  it('loads the site directly when capture is off', async () => {
    mockParams = { url: 'https://seller.example.com/' };
    const r = await render(<NetworkBrowserScreen />);
    expect(byId(r, 'net-webview').props.source).toEqual({
      uri: 'https://seller.example.com/',
    });
    expect(
      byId(r, 'net-webview').props.injectedJavaScriptBeforeContentLoaded,
    ).toBeUndefined();
    expect(byId(r, 'net-indicator').props.children).toBe('Capture off');
    expect(native.attachCaptureScript).not.toHaveBeenCalled();
  });

  it('only lets web pages load', async () => {
    mockParams = { url: 'https://seller.example.com/' };
    const r = await render(<NetworkBrowserScreen />);
    const should = byId(r, 'net-webview').props.onShouldStartLoadWithRequest;
    expect(should({ url: 'https://seller.example.com/x' })).toBe(true);
    let allowed = true;
    await act(() => {
      allowed = should({ url: 'intent://scan/#Intent;scheme=zxing;end' });
    });
    expect(allowed).toBe(false);
  });
});

describe('Captured Network Calls', () => {
  const seed = () => {
    const get = makeRecord({
      method: 'GET',
      url: 'https://seller.example.com/api/orders',
      status: 200,
      startedAt: '2026-11-16T12:00:03.000Z',
    });
    const post = makeRecord({
      method: 'POST',
      url: 'https://seller.example.com/omni/get',
      status: 200,
      startedAt: '2026-11-16T12:00:02.000Z',
    });
    const put = makeRecord({
      method: 'PUT',
      url: 'https://seller.example.com/api/returns',
      status: 400,
      startedAt: '2026-11-16T12:00:01.000Z',
    });
    networkRepository.upsertMany([get, post, put]);
    return { get, post, put };
  };
  const listIds = (r: Renderer) =>
    (byId(r, 'net-list').props.data as { id: string }[]).map(c => c.id);

  it('shows the empty state', async () => {
    const r = await render(<NetworkCallsScreen />);
    expect(has(r, 'net-empty')).toBe(true);
  });

  it('lists, filters and searches', async () => {
    const { get, post, put } = seed();
    const r = await render(<NetworkCallsScreen />);
    expect(listIds(r)).toEqual([get.id, post.id, put.id]);
    expect(text(r)).toContain('/omni/get');
    await act(() => byId(r, 'net-filter-clientError').props.onPress());
    expect(listIds(r)).toEqual([put.id]);
    await act(() => byId(r, 'net-filter-all').props.onPress());
    await act(() => byId(r, 'net-search').props.onChangeText('omni'));
    expect(listIds(r)).toEqual([post.id]);
  });

  it('exports selected calls as one JSON file', async () => {
    const { post } = seed();
    const r = await render(<NetworkCallsScreen />);
    await act(() => byId(r, `net-call-${post.id}`).props.onLongPress());
    expect(text(r)).toContain('1 selected');
    await act(() => byId(r, 'net-export').props.onPress());
    await act(() => alertButton('Share JSON').onPress!());
    expect(native.shareTextFile).toHaveBeenCalledTimes(1);
    const [fileName, mime, json] = native.shareTextFile.mock.calls[0];
    expect(fileName).toMatch(
      /^network-capture-example-\d{4}-\d{2}-\d{2}\.json$/,
    );
    expect(mime).toBe('application/json');
    const doc = JSON.parse(json);
    expect(doc).toHaveLength(1);
    expect(doc[0].id).toBe(post.id);
  });

  it('deletes selected calls and clears all', async () => {
    const { get, post } = seed();
    const r = await render(<NetworkCallsScreen />);
    await act(() => byId(r, `net-call-${get.id}`).props.onLongPress());
    await act(() => byId(r, 'net-delete-selected').props.onPress());
    await act(() => alertButton('Delete').onPress!());
    expect(networkRepository.get(get.id)).toBeNull();
    expect(networkRepository.get(post.id)).not.toBeNull();
    await act(() => byId(r, 'net-clear-all').props.onPress());
    await act(() => alertButton('Clear all').onPress!());
    expect(networkRepository.summaries()).toEqual([]);
  });
});

describe('API detail', () => {
  it('shows each section and copies a redacted cURL', async () => {
    const record = makeRecord({
      requestHeaders: {
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      },
      responseBody: {
        kind: 'json',
        value: { orderId: 74098296398 },
        truncated: false,
        sizeBytes: 25,
      },
    });
    networkRepository.upsertMany([record]);
    mockParams = { callId: record.id };
    const r = await render(<NetworkCallDetailScreen />);
    expect(text(r)).toContain(record.url);
    await act(() => byId(r, 'net-detail-tabs-requestHeaders').props.onPress());
    // On screen: what was captured.
    expect(text(r)).toContain('Bearer secret');
    await act(() => byId(r, 'net-detail-tabs-responseBody').props.onPress());
    expect(text(r)).toContain('74098296398');
    await act(() => byId(r, 'net-detail-tabs-curl').props.onPress());
    expect(text(r)).toContain('Authorization: [REDACTED]');
    await act(() => byId(r, 'net-copy-curl').props.onPress());
    expect(native.copyText.mock.calls[0][0]).toContain('[REDACTED]');
    expect(native.copyText.mock.calls[0][0]).not.toContain('Bearer secret');
    expect(text(r)).toContain('Copied');
  });

  it('deletes the request', async () => {
    const record = makeRecord();
    networkRepository.upsertMany([record]);
    mockParams = { callId: record.id };
    const r = await render(<NetworkCallDetailScreen />);
    await act(() => byId(r, 'net-delete').props.onPress());
    await act(() => alertButton('Delete').onPress!());
    expect(networkRepository.get(record.id)).toBeNull();
    expect(mockGoBack).toHaveBeenCalled();
  });
});
