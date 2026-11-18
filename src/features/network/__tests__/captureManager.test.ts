import { networkStorage, storage } from '@/store/mmkv';
import { networkRepository } from '../repository/network.repository';
import {
  CANCEL_BROWSER_CLOSED,
  CANCEL_PAGE_LEFT,
  CaptureManager,
} from '../services/captureManager';
import { DEFAULT_NETWORK_SETTINGS } from '../store/networkSettings.store';
import type { CapturedRequest, NetworkSettings } from '../types';

const TOKEN = 'session-token-1';
const PAGE = 'https://seller.example.com/orders';
const ORIGIN = 'https://seller.example.com';

let settings: NetworkSettings;
let saved: CapturedRequest[][];

function manager(token = TOKEN) {
  return new CaptureManager(token, {
    settings: () => settings,
    persist: records => {
      saved.push(records);
      networkRepository.upsertMany(records);
    },
    flushMs: 1,
  });
}

const start = (id: string, over: Record<string, unknown> = {}) => ({
  t: 's',
  id,
  ts: 1_000,
  method: 'GET',
  url: 'https://seller.example.com/api/orders',
  headers: { Accept: 'application/json' },
  body: null,
  type: 'Fetch',
  page: PAGE,
  frame: null,
  ...over,
});
const end = (id: string, over: Record<string, unknown> = {}) => ({
  t: 'e',
  id,
  ts: 1_250,
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  mime: 'application/json',
  body: {
    kind: 'json',
    value: { orders: [] },
    truncated: false,
    sizeBytes: 13,
  },
  error: null,
  ...over,
});
const msg = (events: object[], token = TOKEN) =>
  JSON.stringify({ ni: token, v: 1, events });

beforeEach(() => {
  storage.clearAll();
  networkStorage.clearAll();
  networkRepository.resetCacheForTest();
  saved = [];
  settings = {
    ...DEFAULT_NETWORK_SETTINGS,
    enabled: true,
    session: 'recording',
    domains: [{ host: 'seller.example.com', includeSubdomains: false }],
  };
});

describe('CaptureManager', () => {
  it('records a GET with its response and duration', () => {
    const m = manager();
    expect(m.handleMessage(msg([start('p:1'), end('p:1')]), ORIGIN)).toBe(2);
    m.flush();
    const [record] = saved.flat().slice(-1);
    expect(record).toMatchObject({
      source: 'webview',
      method: 'GET',
      url: 'https://seller.example.com/api/orders',
      pageUrl: PAGE,
      origin: ORIGIN,
      status: 200,
      durationMs: 250,
      startedAt: new Date(1_000).toISOString(),
      completedAt: new Date(1_250).toISOString(),
      responseBody: { kind: 'json', value: { orders: [] } },
      metadata: {
        requestId: 'p:1',
        normalizedEndpoint: '/api/orders',
        pending: false,
      },
    });
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.curl).toBe(
      `curl 'https://seller.example.com/api/orders' \\\n  -H 'Accept: application/json'`,
    );
    expect(m.recordedCount).toBe(1);
  });

  it('writes in batches', () => {
    const m = manager();
    m.handleMessage(
      msg([start('p:1'), start('p:2'), end('p:1'), end('p:2')]),
      ORIGIN,
    );
    m.flush();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toHaveLength(2);
  });

  it('records nothing while the toggle is off', () => {
    settings = { ...settings, enabled: false, session: 'stopped' };
    const m = manager();
    expect(m.handleMessage(msg([start('p:1'), end('p:1')]), ORIGIN)).toBe(0);
    m.flush();
    expect(networkRepository.summaries()).toHaveLength(0);
  });

  it('ignores frames and pages outside the allowed domains', () => {
    const m = manager();
    expect(
      m.handleMessage(
        msg([start('p:1')]),
        'https://seller.example.com.attacker.com',
      ),
    ).toBe(0);
    expect(
      m.handleMessage(
        msg([start('p:2', { page: 'https://google.com/' })]),
        ORIGIN,
      ),
    ).toBe(0);
    m.flush();
    expect(networkRepository.summaries()).toHaveLength(0);
  });

  it('applies the request scope', () => {
    const m = manager();
    const thirdParty = { url: 'https://analytics.other.com/collect' };
    expect(m.handleMessage(msg([start('p:1', thirdParty)]), ORIGIN)).toBe(0);
    settings = { ...settings, scope: 'allFromPage' };
    expect(m.handleMessage(msg([start('p:2', thirdParty)]), ORIGIN)).toBe(1);
  });

  it('drops messages without this session token', () => {
    const m = manager();
    expect(m.handleMessage(msg([start('p:1')], 'forged'), ORIGIN)).toBe(0);
    expect(m.handleMessage('not json', ORIGIN)).toBe(0);
    expect(
      m.handleMessage(
        JSON.stringify({ ni: TOKEN, v: 99, events: [start('p:1')] }),
        ORIGIN,
      ),
    ).toBe(0);
  });

  it('pauses new requests but completes ones in flight; resumes', () => {
    const m = manager();
    m.handleMessage(msg([start('p:1')]), ORIGIN);
    settings = { ...settings, session: 'paused' };
    expect(m.handleMessage(msg([start('p:2'), end('p:1')]), ORIGIN)).toBe(1);
    settings = { ...settings, session: 'recording' };
    expect(m.handleMessage(msg([start('p:3')]), ORIGIN)).toBe(1);
    m.flush();
    const ids = networkRepository.summaries().map(s => s.status);
    expect(ids).toHaveLength(2);
  });

  it('de-duplicates by request identity, not URL', () => {
    const m = manager();
    m.handleMessage(msg([start('p:1'), start('p:1'), start('p:2')]), ORIGIN);
    m.handleMessage(
      msg([
        end('p:2', { status: 404 }),
        end('p:1'),
        end('p:1', { status: 500 }),
      ]),
      ORIGIN,
    );
    m.flush();
    const byRequest = Object.fromEntries(
      networkRepository
        .summaries()
        .map(s => [networkRepository.get(s.id)!.metadata.requestId, s.status]),
    );
    expect(byRequest).toEqual({ 'p:1': 200, 'p:2': 404 });
  });

  it('records failures, page unloads and browser close', () => {
    const m = manager();
    m.handleMessage(
      msg([
        start('p:1'),
        end('p:1', { status: null, error: 'Failed to fetch', body: null }),
        start('p:2'),
        start('p:3'),
        { t: 'u', ids: ['p:2'] },
      ]),
      ORIGIN,
    );
    m.dispose();
    const byRequest = Object.fromEntries(
      networkRepository
        .summaries()
        .map(s => [networkRepository.get(s.id)!.metadata.requestId, s.error]),
    );
    expect(byRequest).toEqual({
      'p:1': 'Failed to fetch',
      'p:2': CANCEL_PAGE_LEFT,
      'p:3': CANCEL_BROWSER_CLOSED,
    });
    expect(m.handleMessage(msg([start('p:9')]), ORIGIN)).toBe(0);
  });

  it('adds the browser cookies to requests that send them, and to the cURL', async () => {
    const cookies = jest.fn(async () => 'colorPref=dark; sid=abc');
    const m = new CaptureManager(TOKEN, {
      settings: () => settings,
      persist: records => networkRepository.upsertMany(records),
      flushMs: 1,
      cookies,
    });
    m.handleMessage(
      msg([
        start('p:1', {
          method: 'POST',
          cred: true,
          added: ['Accept', 'Missing'],
          ck: 'ignored=page-cookie',
        }),
        start('p:2', { cred: false }),
      ]),
      ORIGIN,
    );
    // The response can arrive before the cookie lookup answers.
    m.handleMessage(msg([end('p:1')]), ORIGIN);
    await Promise.resolve();
    await Promise.resolve();
    m.flush();
    expect(cookies).toHaveBeenCalledTimes(1);
    expect(cookies).toHaveBeenCalledWith(
      'https://seller.example.com/api/orders',
    );
    const byRequest = Object.fromEntries(
      networkRepository
        .summaries()
        .map(s => networkRepository.get(s.id)!)
        .map(r => [r.metadata.requestId, r]),
    );
    const withCookies = byRequest['p:1'];
    expect(withCookies.requestHeaders.Cookie).toBe('colorPref=dark; sid=abc');
    expect(withCookies.status).toBe(200);
    expect(withCookies.metadata.inferredHeaders).toEqual(['Accept', 'Cookie']);
    expect(withCookies.curl).toContain(
      `-b 'colorPref=[REDACTED]; sid=[REDACTED]'`,
    );
    expect(byRequest['p:2'].requestHeaders.Cookie).toBeUndefined();
  });

  it("uses the page's cookies where the store can't be read", () => {
    const m = manager();
    m.handleMessage(
      msg([start('p:1', { cred: true, ck: 'colorPref=dark' })]),
      ORIGIN,
    );
    m.flush();
    const record = networkRepository.get(networkRepository.summaries()[0].id)!;
    expect(record.requestHeaders.Cookie).toBe('colorPref=dark');
    expect(record.metadata.inferredHeaders).toEqual(['Cookie']);
  });

  it('enforces the body limit even if the page did not', () => {
    settings = { ...settings, bodyLimitKb: 32 };
    const m = manager();
    m.handleMessage(
      msg([
        start('p:1', {
          method: 'POST',
          body: {
            kind: 'text',
            value: 'y'.repeat(40 * 1024),
            truncated: false,
            sizeBytes: 40960,
          },
        }),
      ]),
      ORIGIN,
    );
    m.flush();
    const record = networkRepository.get(networkRepository.summaries()[0].id)!;
    expect(record.requestBody).toMatchObject({
      kind: 'text',
      truncated: true,
      sizeBytes: 40960,
    });
    expect((record.requestBody!.value as string).length).toBe(32 * 1024);
  });
});
