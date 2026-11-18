import {
  buildCaptureScript,
  setActiveSnippet,
} from '../services/captureScript';
import type { DomainRule } from '../types';

/**
 * Runs the real in-page capture script against a simulated page: Node's
 * fetch primitives (Response, Request, Headers, FormData, Blob) plus a fake
 * XMLHttpRequest and bridge. Checks what reaches the app, and that the
 * page's own requests behave exactly as without the recorder.
 */

/**
 * Node's web primitives, which the simulated page uses. The app's typings
 * are React Native's (no @types/node), so they're reached through one
 * loosely typed handle — test-only.
 */
// `any`: Node globals have no typings in this project (see above).
const node = globalThis as unknown as Record<string, any>;
const NodeURL = require('url').URL;
const tick = () => new Promise<void>(resolve => node.setImmediate(resolve));

type Posted = { ni: string; v: number; events: Record<string, any>[] };

class FakeXHR {
  static last: FakeXHR | null = null;
  listeners: Record<string, (() => void)[]> = {};
  status = 0;
  statusText = '';
  responseText = '';
  responseType = '';
  response: unknown = null;
  headersRaw = '';
  sent: unknown = undefined;
  open(_method?: string, _url?: string) {}
  setRequestHeader(_name?: string, _value?: string) {}
  send(body?: unknown) {
    this.sent = body;
    FakeXHR.last = this;
  }
  addEventListener(type: string, fn: () => void) {
    (this.listeners[type] ||= []).push(fn);
  }
  getAllResponseHeaders() {
    return this.headersRaw;
  }
  fire(type: string) {
    (this.listeners[type] || []).forEach(fn => fn());
  }
}

const RULES: DomainRule[] = [
  { host: 'seller.example.com', includeSubdomains: false },
];
const TOKEN = 'tok123';

function makePage(
  href: string,
  options: {
    rules?: DomainRule[];
    limit?: number;
    fetchImpl?: (input: unknown, init?: unknown) => Promise<Response>;
    nav?: Record<string, unknown>;
    pageCookies?: boolean;
    cookie?: string;
    referrerMeta?: string;
  } = {},
) {
  const posted: Posted[] = [];
  const timers: (() => void)[] = [];
  const listeners: Record<string, () => void> = {};
  const XHR = class extends FakeXHR {};
  const originalFetch = jest.fn(
    options.fetchImpl ??
      (async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })),
  );
  const sendBeacon = jest.fn(() => true);
  const win: Record<string, any> = {
    location: new NodeURL(href),
    document: {
      baseURI: href,
      cookie: options.cookie ?? '',
      querySelector: (sel: string) =>
        sel === 'meta[name="referrer"]' && options.referrerMeta
          ? { getAttribute: () => options.referrerMeta }
          : null,
    },
    URL: NodeURL,
    TextEncoder: node.TextEncoder,
    TextDecoder: node.TextDecoder,
    btoa: node.btoa,
    Response,
    Request,
    Headers,
    FormData,
    Blob,
    URLSearchParams,
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    fetch: originalFetch,
    XMLHttpRequest: XHR,
    navigator: { sendBeacon, ...options.nav },
    ReactNativeWebView: {
      postMessage: (s: string) => posted.push(JSON.parse(s)),
    },
    addEventListener: (type: string, fn: () => void) => {
      listeners[type] = fn;
    },
  };
  win.top = win;
  const script = buildCaptureScript({
    token: TOKEN,
    rules: options.rules ?? RULES,
    bodyLimitBytes: options.limit ?? 64 * 1024,
    pageCookies: options.pageCookies,
  });
  // eslint-disable-next-line no-new-func
  new Function('window', script)(win);
  const events = () => posted.flatMap(p => p.events);
  async function settle() {
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < 25; i++) {
        await tick();
      }
      timers.splice(0).forEach(fn => fn());
    }
  }
  return {
    win,
    posted,
    events,
    settle,
    originalFetch,
    sendBeacon,
    XHR,
    listeners,
  };
}

describe('capture script scope', () => {
  it('does nothing on a site that is not allowed', () => {
    const page = makePage('https://google.com/');
    expect(page.win.fetch).toBe(page.originalFetch);
    expect(page.win.__aksharNetInspector).toBeUndefined();
  });

  it('is not fooled by a look-alike host', () => {
    const page = makePage('https://seller.example.com.attacker.com/');
    expect(page.win.fetch).toBe(page.originalFetch);
  });

  it('runs on the exact allowed host', () => {
    const page = makePage('https://seller.example.com/orders');
    expect(page.win.fetch).not.toBe(page.originalFetch);
  });

  it('includes subdomains only when the rule says so', () => {
    expect(
      makePage('https://api.example.com/', {
        rules: [{ host: 'example.com', includeSubdomains: false }],
      }).win.fetch.mock,
    ).toBeDefined();
    expect(
      makePage('https://api.example.com/', {
        rules: [{ host: 'example.com', includeSubdomains: true }],
      }).win.fetch.mock,
    ).toBeUndefined();
  });

  it('installs only once per document', () => {
    const page = makePage('https://seller.example.com/');
    const wrapped = page.win.fetch;
    // eslint-disable-next-line no-new-func
    new Function(
      'window',
      buildCaptureScript({
        token: 'other',
        rules: RULES,
        bodyLimitBytes: 1024,
      }),
    )(page.win);
    expect(page.win.fetch).toBe(wrapped);
  });
});

describe('fetch capture', () => {
  it('records a POST JSON request and its JSON response, unchanged for the page', async () => {
    const page = makePage('https://seller.example.com/returns');
    const res: Response = await page.win.fetch('/omni/get', {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ name: 'search', params: { q: 'a|b' } }),
    });
    // The page still reads the body itself.
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(page.originalFetch).toHaveBeenCalledTimes(1);
    await page.settle();

    expect(page.posted.every(p => p.ni === TOKEN && p.v === 1)).toBe(true);
    const [start, end] = page.events();
    expect(start).toMatchObject({
      t: 's',
      method: 'POST',
      url: 'https://seller.example.com/omni/get',
      type: 'Fetch',
      page: 'https://seller.example.com/returns',
      frame: null,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: {
        kind: 'json',
        value: { name: 'search', params: { q: 'a|b' } },
        truncated: false,
      },
    });
    expect(end).toMatchObject({
      t: 'e',
      id: start.id,
      status: 200,
      error: null,
      mime: 'application/json',
      body: {
        kind: 'json',
        value: { ok: true },
        truncated: false,
        sizeBytes: 11,
      },
    });
  });

  it('keeps text responses as text and marks large ones truncated', async () => {
    const big = 'x'.repeat(5000);
    const page = makePage('https://seller.example.com/', {
      limit: 1024,
      fetchImpl: async () =>
        new Response(big, {
          status: 200,
          headers: { 'content-type': 'text/plain', 'content-length': '5000' },
        }),
    });
    const res: Response = await page.win.fetch(
      'https://seller.example.com/big',
    );
    await expect(res.text()).resolves.toHaveLength(5000);
    await page.settle();
    const end = page.events().find(e => e.t === 'e')!;
    expect(end.body.kind).toBe('text');
    expect(end.body.truncated).toBe(true);
    expect(end.body.value.length).toBe(1024);
    expect(end.body.sizeBytes).toBe(5000);
  });

  it('stores small binary responses as base64, never as text', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    const page = makePage('https://seller.example.com/', {
      fetchImpl: async () =>
        new Response(bytes, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
    });
    await page.win.fetch('/logo.png');
    await page.settle();
    const end = page.events().find(e => e.t === 'e')!;
    expect(end.body).toMatchObject({
      kind: 'binary',
      encoding: 'base64',
      sizeBytes: 6,
    });
    expect(
      Array.from(node.atob(end.body.value) as string, c => c.charCodeAt(0)),
    ).toEqual(Array.from(bytes));
  });

  it('records a network failure and still rejects for the page', async () => {
    const page = makePage('https://seller.example.com/', {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(page.win.fetch('/api/down')).rejects.toThrow(
      'Failed to fetch',
    );
    await page.settle();
    const end = page.events().find(e => e.t === 'e')!;
    expect(end).toMatchObject({ status: null, error: 'Failed to fetch' });
  });

  it('keeps each concurrent request paired with its own response', async () => {
    let n = 0;
    const page = makePage('https://seller.example.com/', {
      fetchImpl: async () => {
        const mine = ++n;
        await tick();
        return new Response(JSON.stringify({ mine }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    await Promise.all([page.win.fetch('/same'), page.win.fetch('/same')]);
    await page.settle();
    const starts = page.events().filter(e => e.t === 's');
    const ends = page.events().filter(e => e.t === 'e');
    expect(new Set(starts.map(s => s.id)).size).toBe(2);
    expect(ends.map(e => e.body.value.mine).sort()).toEqual([1, 2]);
    expect(new Set(ends.map(e => e.id))).toEqual(
      new Set(starts.map(s => s.id)),
    );
  });

  it('records FormData fields and files by name, without reading files', async () => {
    const page = makePage('https://seller.example.com/');
    const form = new FormData();
    form.append('orderId', '42');
    // Node's FormData (the one the page uses here) takes a file name; React
    // Native's typings don't declare that overload.
    (form as unknown as { append: (...a: unknown[]) => void }).append(
      'doc',
      new Blob(['%PDF'], { type: 'application/pdf' } as BlobOptions),
      'invoice.pdf',
    );
    await page.win.fetch('/upload', { method: 'POST', body: form });
    await page.settle();
    const start = page.events().find(e => e.t === 's')!;
    expect(start.body.kind).toBe('formData');
    expect(start.body.value).toEqual([
      { name: 'orderId', value: '42' },
      {
        name: 'doc',
        value: null,
        fileName: 'invoice.pdf',
        type: 'application/pdf',
        sizeBytes: 4,
      },
    ]);
  });

  it('sends nothing while paused', async () => {
    const page = makePage('https://seller.example.com/');
    // eslint-disable-next-line no-new-func
    new Function('window', setActiveSnippet(false))(page.win);
    await page.win.fetch('/api/orders');
    await page.settle();
    expect(page.events()).toHaveLength(0);
    // eslint-disable-next-line no-new-func
    new Function('window', setActiveSnippet(true))(page.win);
    await page.win.fetch('/api/orders');
    await page.settle();
    expect(page.events().filter(e => e.t === 's')).toHaveLength(1);
  });

  it('reports requests still in flight when the page is left', async () => {
    const page = makePage('https://seller.example.com/', {
      fetchImpl: () => new Promise<Response>(() => undefined),
    });
    page.win.fetch('/slow');
    await page.settle();
    page.listeners.pagehide();
    const unload = page.events().find(e => e.t === 'u')!;
    const start = page.events().find(e => e.t === 's')!;
    expect(unload.ids).toEqual([start.id]);
  });
});

describe('XMLHttpRequest capture', () => {
  it('records method, headers, body and the response', async () => {
    const page = makePage('https://seller.example.com/');
    const xhr = new page.XHR();
    xhr.open('PUT', '/api/returns/7');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send('{"reason":"damaged"}');
    xhr.status = 400;
    xhr.statusText = 'Bad Request';
    xhr.headersRaw = 'content-type: application/json\r\nx-trace: abc\r\n';
    xhr.responseText = '{"error":"closed"}';
    xhr.fire('load');
    xhr.fire('loadend');
    await page.settle();
    expect(xhr.sent).toBe('{"reason":"damaged"}');
    const [start, end] = page.events();
    expect(start).toMatchObject({
      method: 'PUT',
      url: 'https://seller.example.com/api/returns/7',
      type: 'XHR',
      body: { kind: 'json', value: { reason: 'damaged' } },
    });
    expect(end).toMatchObject({
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
      body: { kind: 'json', value: { error: 'closed' } },
      error: null,
    });
  });

  it('records an aborted request as cancelled', async () => {
    const page = makePage('https://seller.example.com/');
    const xhr = new page.XHR();
    xhr.open('GET', '/api/slow');
    xhr.send();
    xhr.fire('abort');
    xhr.fire('loadend');
    await page.settle();
    const end = page.events().find(e => e.t === 'e')!;
    expect(end.error).toMatch(/Cancelled/);
    expect(end.status).toBeNull();
  });
});

describe('browser-added request headers', () => {
  const ANDROID_UA =
    'Mozilla/5.0 (Linux; Android 15; SM-S928B Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/157.0.0.0 Mobile Safari/537.36';
  const nav = {
    userAgent: ANDROID_UA,
    languages: ['en-IN', 'en-GB', 'hi'],
    userAgentData: {
      brands: [
        { brand: 'Not-A.Brand', version: '99' },
        { brand: 'Android WebView', version: '157' },
      ],
      mobile: true,
      platform: 'Android',
    },
  };

  it('fills in what the browser sends for a same-origin POST', async () => {
    const page = makePage(
      'https://seller.example.com/en/apps/company/list#top',
      { nav },
    );
    await page.win.fetch('/api/company/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"page":1}',
    });
    await page.settle();
    const [start] = page.events();
    expect(start.headers).toEqual({
      'content-type': 'application/json',
      Accept: '*/*',
      'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8,hi;q=0.7',
      Origin: 'https://seller.example.com',
      Referer: 'https://seller.example.com/en/apps/company/list',
      'User-Agent': ANDROID_UA,
      'sec-ch-ua': '"Not-A.Brand";v="99", "Android WebView";v="157"',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    });
    expect(start.added).not.toContain('content-type');
    expect(start.added).toContain('User-Agent');
    // Same-origin fetch: the browser attaches cookies.
    expect(start.cred).toBe(true);
    // The app reads cookies natively unless told otherwise.
    expect(start.ck).toBeNull();
  });

  it("keeps the page's own headers and follows cross-origin rules", async () => {
    const page = makePage('https://seller.example.com/orders?x=1', { nav });
    await page.win.fetch('https://log.example.com/eventData', {
      headers: { Accept: 'application/json' },
    });
    const xhr = new page.XHR();
    xhr.open('GET', 'https://api.other.org/v1');
    (xhr as unknown as { withCredentials: boolean }).withCredentials = true;
    xhr.send();
    await page.settle();
    const [fetchStart, xhrStart] = page.events().filter(e => e.t === 's');
    expect(fetchStart.headers).toMatchObject({
      Accept: 'application/json',
      Origin: 'https://seller.example.com',
      Referer: 'https://seller.example.com/',
      'sec-fetch-site': 'same-site',
    });
    // Cross-origin with the default credentials mode: no cookies.
    expect(fetchStart.cred).toBe(false);
    expect(xhrStart.headers['sec-fetch-site']).toBe('cross-site');
    expect(xhrStart.cred).toBe(true);
  });

  it('honours the referrer policy and sends no Origin on a same-origin GET', async () => {
    const page = makePage('https://seller.example.com/a', {
      nav,
      referrerMeta: 'no-referrer',
    });
    await page.win.fetch('/b');
    await page.win.fetch('/c', { referrerPolicy: 'unsafe-url' });
    await page.settle();
    const [first, second] = page.events().filter(e => e.t === 's');
    expect(first.headers.Referer).toBeUndefined();
    expect(first.headers.Origin).toBeUndefined();
    expect(second.headers.Referer).toBe('https://seller.example.com/a');
  });

  it('sends document.cookie only where the app asks for it', async () => {
    const page = makePage('https://seller.example.com/', {
      pageCookies: true,
      cookie: 'colorPref=dark',
    });
    await page.win.fetch('/api/x');
    await page.win.fetch('/api/y', { credentials: 'omit' });
    await page.settle();
    const [withCookies, omitted] = page.events().filter(e => e.t === 's');
    expect(withCookies.ck).toBe('colorPref=dark');
    expect(omitted).toMatchObject({ cred: false, ck: null });
  });
});

describe('sendBeacon capture', () => {
  it('records the beacon and passes it through', async () => {
    const page = makePage('https://seller.example.com/');
    expect(page.win.navigator.sendBeacon('/log', 'event=view')).toBe(true);
    expect(page.sendBeacon).toHaveBeenCalledWith('/log', 'event=view');
    await page.settle();
    const end = page.events().find(e => e.t === 'e')!;
    expect(end).toMatchObject({ beacon: true, status: null, error: null });
  });
});

describe('end to end: page → app → storage', () => {
  it('stores what the page sends, through the real manager', async () => {
    // Imported here so the storage mock is fresh for this block.
    const { CaptureManager } = require('../services/captureManager');
    const { networkRepository } = require('../repository/network.repository');
    const {
      DEFAULT_NETWORK_SETTINGS,
    } = require('../store/networkSettings.store');
    networkRepository.clear();
    const page = makePage('https://seller.example.com/returns');
    const manager = new CaptureManager(TOKEN, {
      settings: () => ({
        ...DEFAULT_NETWORK_SETTINGS,
        enabled: true,
        session: 'recording',
        domains: RULES,
      }),
      persist: (records: unknown[]) => networkRepository.upsertMany(records),
    });
    await page.win.fetch('/omni/get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"returns_dispute_search_Click"}',
    });
    await page.settle();
    for (const p of page.posted) {
      manager.handleMessage(JSON.stringify(p), 'https://seller.example.com');
    }
    manager.dispose();
    const [summary] = networkRepository.summaries();
    const record = networkRepository.get(summary.id);
    expect(record).toMatchObject({
      method: 'POST',
      url: 'https://seller.example.com/omni/get',
      status: 200,
      requestBody: {
        kind: 'json',
        value: { name: 'returns_dispute_search_Click' },
      },
      responseBody: { kind: 'json', value: { ok: true } },
      error: null,
    });
    expect(record.curl).toContain(
      `--data-raw '{"name":"returns_dispute_search_Click"}'`,
    );
  });
});
