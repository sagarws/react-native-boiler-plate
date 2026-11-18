import { networkStorage, storage } from '@/store/mmkv';
import {
  networkRepository,
  MAX_RECORDS,
} from '../repository/network.repository';
import { generateCurl, shellQuote } from '../services/curl';
import {
  buildExport,
  exportFileName,
  siteLabel,
} from '../services/export.service';
import { REDACTED, redactRecord, redactUrl } from '../services/redact';
import { networkSettingsStore } from '../store/networkSettings.store';
import type { CallSummary } from '../types';
import {
  hostMatchesRule,
  isUrlAllowed,
  parseDomainInput,
  toOriginRules,
} from '../utils/domainFilter';
import { filterCalls, statusClass } from '../utils/filters';
import { endpointOf, normalizeAddress, parseUrl } from '../utils/url';
import { uuidV4 } from '../utils/uuid';
import { makeRecord } from '../__fixtures__/records';

// Node's child_process, typed locally (the app has no @types/node): the cURL
// tests run commands through a real POSIX shell.
const { execFileSync } = require('child_process') as {
  execFileSync: (file: string, args: string[]) => { toString(): string };
};

/** A script URL as hostile input (built so linters don't flag it). */
const HOSTILE_URL = ['javascript', 'alert(1)'].join(':');

beforeEach(() => {
  storage.clearAll();
  networkStorage.clearAll();
  networkRepository.resetCacheForTest();
  networkSettingsStore.resetCacheForTest();
});

describe('URL parsing', () => {
  it('splits host, port, path and query', () => {
    expect(
      parseUrl('HTTPS://Seller.Example.com:443/a/b?x=1#frag'),
    ).toMatchObject({
      scheme: 'https',
      hostname: 'seller.example.com',
      port: '',
      path: '/a/b',
      query: '?x=1',
      origin: 'https://seller.example.com',
    });
    expect(parseUrl('http://localhost:3000')?.origin).toBe(
      'http://localhost:3000',
    );
  });

  it('never takes userinfo for the host', () => {
    expect(parseUrl('https://seller.example.com@evil.com/x')?.hostname).toBe(
      'evil.com',
    );
  });

  it('normalises typed addresses and rejects other schemes', () => {
    expect(normalizeAddress('seller.example.com')).toBe(
      'https://seller.example.com',
    );
    expect(normalizeAddress('http://seller.example.com/x')).toBe(
      'http://seller.example.com/x',
    );
    expect(normalizeAddress(HOSTILE_URL)).toBeNull();
    expect(normalizeAddress('file:///etc/hosts')).toBeNull();
    expect(normalizeAddress('not a url')).toBeNull();
    expect(endpointOf('https://a.com/api/orders?page=2')).toBe(
      '/api/orders?page=2',
    );
  });
});

describe('domain filtering', () => {
  const exact = parseDomainInput('seller.snapdeal.com')!;

  it('parses domains, URLs and wildcards', () => {
    expect(exact).toEqual({
      host: 'seller.snapdeal.com',
      includeSubdomains: false,
    });
    expect(parseDomainInput('https://Seller.Snapdeal.com/orders')).toEqual(
      exact,
    );
    expect(parseDomainInput('*.snapdeal.com')).toEqual({
      host: 'snapdeal.com',
      includeSubdomains: true,
    });
    expect(parseDomainInput('localhost:8080')).toEqual({
      host: 'localhost:8080',
      includeSubdomains: false,
    });
    for (const bad of [
      '',
      'seller',
      'a b.com',
      'ftp://x.com',
      'x..com',
      '-a.com',
      '1.2.3.999',
    ]) {
      expect(parseDomainInput(bad)).toBeNull();
    }
  });

  it('matches the exact host only', () => {
    for (const url of [
      'https://seller.snapdeal.com/',
      'https://seller.snapdeal.com/orders',
      'https://seller.snapdeal.com/api/users',
    ]) {
      expect(isUrlAllowed(url, [exact])).toBe(true);
    }
    for (const url of [
      'https://google.com/',
      'https://example.com/',
      'https://seller.snapdeal.com.attacker.com/',
      'https://evilseller.snapdeal.com/',
      'https://api.seller.snapdeal.com/',
      'https://seller.snapdeal.com@attacker.com/',
      'https://seller.snapdeal.com:8443/',
      'ftp://seller.snapdeal.com/',
      HOSTILE_URL,
    ]) {
      expect(isUrlAllowed(url, [exact])).toBe(false);
    }
  });

  it('matches subdomains only when enabled', () => {
    const subs = { host: 'snapdeal.com', includeSubdomains: true };
    expect(hostMatchesRule('seller.snapdeal.com', subs)).toBe(true);
    expect(hostMatchesRule('snapdeal.com', subs)).toBe(true);
    expect(hostMatchesRule('notsnapdeal.com', subs)).toBe(false);
    expect(hostMatchesRule('snapdeal.com.evil.io', subs)).toBe(false);
    expect(
      hostMatchesRule('seller.snapdeal.com', {
        ...subs,
        includeSubdomains: false,
      }),
    ).toBe(false);
  });

  it('builds Chromium origin rules', () => {
    expect(
      toOriginRules([exact, { host: 'amazon.in', includeSubdomains: true }]),
    ).toEqual([
      'https://seller.snapdeal.com',
      'http://seller.snapdeal.com',
      'https://amazon.in',
      'https://*.amazon.in',
      'http://amazon.in',
      'http://*.amazon.in',
    ]);
  });
});

describe('redaction', () => {
  it('redacts tokens, cookies and passwords but keeps the rest', () => {
    const record = makeRecord({
      url: 'https://seller.example.com/api?access_token=abc&page=2',
      requestHeaders: {
        Authorization: 'Bearer x',
        Cookie: 's=1',
        'X-CSRF-Token': 't',
        Accept: 'application/json',
      },
      requestBody: {
        kind: 'json',
        value: {
          username: 'u',
          password: 'p',
          nested: { refresh_token: 'r', author: 'Ann' },
          pincode: '110001',
        },
        truncated: false,
        sizeBytes: 10,
      },
      responseHeaders: {
        'Set-Cookie': 'sid=1',
        'content-type': 'application/json',
      },
    });
    const safe = redactRecord(record, false);
    expect(safe.url).toBe(
      `https://seller.example.com/api?access_token=${REDACTED}&page=2`,
    );
    expect(safe.requestHeaders).toEqual({
      Authorization: REDACTED,
      Cookie: `s=${REDACTED}`,
      'X-CSRF-Token': REDACTED,
      Accept: 'application/json',
    });
    expect(safe.requestBody?.value).toEqual({
      username: 'u',
      password: REDACTED,
      nested: { refresh_token: REDACTED, author: 'Ann' },
      pincode: '110001',
    });
    expect(safe.responseHeaders['Set-Cookie']).toBe(REDACTED);
    // The stored record is untouched.
    expect(record.requestHeaders.Authorization).toBe('Bearer x');
    expect(redactRecord(record, true)).toBe(record);
  });

  it('redacts url-encoded bodies and query strings', () => {
    expect(redactUrl('https://a.com/x?otp=1234&q=ok#h')).toBe(
      `https://a.com/x?otp=${REDACTED}&q=ok#h`,
    );
    const safe = redactRecord(
      makeRecord({
        requestBody: {
          kind: 'text',
          value: 'user=a&password=b',
          truncated: false,
          sizeBytes: 17,
        },
      }),
      false,
    );
    expect(safe.requestBody?.value).toBe(`user=a&password=${REDACTED}`);
  });
});

describe('cURL generation', () => {
  /** What a POSIX shell actually passes for a quoted argument. */
  const shellArg = (quoted: string) =>
    execFileSync('/bin/sh', ['-c', `printf '%s' ${quoted}`]).toString();

  it('quotes so the shell receives the exact value', () => {
    for (const value of [
      `it's`,
      `a"b`,
      '$HOME `id` \\n !x',
      'line1\nline2',
      `'''`,
      '',
    ]) {
      expect(shellArg(shellQuote(value))).toBe(value);
    }
  });

  it('builds method, headers, query and JSON body', () => {
    const curl = generateCurl(
      makeRecord({
        url: "https://seller.example.com/omni/get?q=it's&x=1",
        requestHeaders: {
          'Content-Type': 'application/json;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Length': '5',
        },
        requestBody: {
          kind: 'json',
          value: { name: "o'k", params: { s: 'a|b' } },
          truncated: false,
          sizeBytes: 20,
        },
      }),
      false,
    );
    expect(curl).toBe(
      [
        `curl 'https://seller.example.com/omni/get?q=it'\\''s&x=1'`,
        `-H 'Content-Type: application/json;charset=UTF-8'`,
        `-H 'X-Requested-With: XMLHttpRequest'`,
        `--data-raw '{"name":"o'\\''k","params":{"s":"a|b"}}'`,
      ].join(' \\\n  '),
    );
    // And the whole command parses in a real shell to the intended argv.
    const argv = execFileSync('/bin/sh', [
      '-c',
      `set -- ${curl.replace(
        /^curl /,
        '',
      )}; for a; do printf '%s\\0' "$a"; done`,
    ])
      .toString()
      .split('\0')
      .filter(Boolean);
    expect(argv).toEqual([
      "https://seller.example.com/omni/get?q=it's&x=1",
      '-H',
      'Content-Type: application/json;charset=UTF-8',
      '-H',
      'X-Requested-With: XMLHttpRequest',
      '--data-raw',
      `{"name":"o'k","params":{"s":"a|b"}}`,
    ]);
  });

  it('writes cookies as -b like a browser, with -X only when curl needs it', () => {
    const cookie = 'colorPref=dark; __Secure-next-auth.session-token=eyJ.x';
    const post = makeRecord({
      method: 'POST',
      requestHeaders: {
        'content-type': 'application/json',
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; wv)',
      },
      requestBody: {
        kind: 'json',
        value: { page: 1, limit: 10, search: '' },
        truncated: false,
        sizeBytes: 33,
      },
    });
    expect(generateCurl(post, true)).toBe(
      [
        `curl 'https://seller.example.com/omni/get'`,
        `-H 'content-type: application/json'`,
        `-b '${cookie}'`,
        `-H 'User-Agent: Mozilla/5.0 (Linux; Android 15; wv)'`,
        `--data-raw '{"page":1,"limit":10,"search":""}'`,
      ].join(' \\\n  '),
    );
    // Redacted by default: cookie names stay, values go.
    expect(generateCurl(post, false)).toContain(
      `-b 'colorPref=${REDACTED}; __Secure-next-auth.session-token=${REDACTED}'`,
    );
    expect(generateCurl({ ...post, method: 'PUT' }, true)).toContain(
      `-X 'PUT'`,
    );
    expect(
      generateCurl({ ...post, method: 'DELETE', requestBody: null }, true),
    ).toContain(`-X 'DELETE'`);
  });

  it('omits -X for a plain GET and redacts by default', () => {
    const record = makeRecord({
      method: 'GET',
      requestBody: null,
      requestHeaders: { Authorization: 'Bearer secret' },
    });
    expect(generateCurl(record, false)).toBe(
      `curl 'https://seller.example.com/omni/get' \\\n  -H 'Authorization: ${REDACTED}'`,
    );
    expect(generateCurl(record, true)).toContain('Bearer secret');
  });

  it('uses --form-string for form fields and drops the multipart Content-Type', () => {
    const curl = generateCurl(
      makeRecord({
        requestHeaders: { 'Content-Type': 'multipart/form-data; boundary=x' },
        requestBody: {
          kind: 'formData',
          value: [{ name: 'a', value: '@notafile' }],
          truncated: false,
          sizeBytes: null,
        },
      }),
      false,
    );
    expect(curl).toContain(`--form-string 'a=@notafile'`);
    expect(curl).not.toContain('multipart');
  });
});

describe('filters', () => {
  const s = (over: Partial<CallSummary>): CallSummary => ({
    id: uuidV4(),
    method: 'GET',
    url: 'https://a.com/api/orders',
    host: 'a.com',
    endpoint: '/api/orders',
    status: 200,
    error: null,
    pending: false,
    durationMs: 5,
    startedAt: '2026-11-16T12:00:00.000Z',
    pageOrigin: 'https://a.com',
    ...over,
  });
  const calls = [
    s({ method: 'GET', status: 200 }),
    s({ method: 'POST', status: 201, url: 'https://a.com/omni/get' }),
    s({ method: 'PUT', status: 400, url: 'https://a.com/api/returns' }),
    s({ method: 'DELETE', status: 503 }),
    s({ method: 'GET', status: null, error: 'Network error' }),
    s({ method: 'GET', status: null, pending: true }),
  ];

  it('filters by method and status class', () => {
    expect(filterCalls(calls, 'all', '')).toHaveLength(6);
    expect(filterCalls(calls, 'GET', '')).toHaveLength(3);
    expect(filterCalls(calls, 'POST', '')).toHaveLength(1);
    expect(filterCalls(calls, 'success', '')).toHaveLength(2);
    expect(filterCalls(calls, 'clientError', '')).toHaveLength(1);
    expect(filterCalls(calls, 'serverError', '')).toHaveLength(1);
    expect(filterCalls(calls, 'failed', '')).toHaveLength(1);
    expect(statusClass(calls[5])).toBe('pending');
  });

  it('searches URL, endpoint, method and status', () => {
    expect(filterCalls(calls, 'all', 'omni')).toHaveLength(1);
    expect(filterCalls(calls, 'all', 'put returns')).toHaveLength(1);
    expect(filterCalls(calls, 'all', '503')).toHaveLength(1);
    expect(filterCalls(calls, 'all', 'nothing-here')).toHaveLength(0);
  });
});

describe('repository', () => {
  it('persists records across a restart (cache dropped)', () => {
    const record = makeRecord();
    networkRepository.upsertMany([record]);
    networkRepository.resetCacheForTest();
    expect(networkRepository.summaries().map(x => x.id)).toEqual([record.id]);
    expect(networkRepository.get(record.id)).toEqual(record);
  });

  it('orders newest first, replaces by id and caps the count', () => {
    const older = makeRecord({ startedAt: '2026-11-16T10:00:00.000Z' });
    const newer = makeRecord({ startedAt: '2026-11-16T11:00:00.000Z' });
    networkRepository.upsertMany([older, newer]);
    networkRepository.upsertMany([{ ...older, status: 500 }]);
    expect(networkRepository.summaries().map(x => [x.id, x.status])).toEqual([
      [newer.id, 200],
      [older.id, 500],
    ]);
    const many = Array.from({ length: MAX_RECORDS + 5 }, (_, i) =>
      makeRecord({
        startedAt: new Date(Date.UTC(2027, 0, 1, 0, 0, i)).toISOString(),
      }),
    );
    networkRepository.upsertMany(many);
    expect(networkRepository.summaries()).toHaveLength(MAX_RECORDS);
    expect(networkRepository.get(older.id)).toBeNull();
  });

  it('deletes one, and clears all', () => {
    const a = makeRecord();
    const b = makeRecord();
    networkRepository.upsertMany([a, b]);
    networkRepository.remove([a.id]);
    expect(networkRepository.summaries().map(x => x.id)).toEqual([b.id]);
    expect(networkRepository.get(a.id)).toBeNull();
    networkRepository.clear();
    expect(networkRepository.summaries()).toEqual([]);
    networkRepository.resetCacheForTest();
    expect(networkRepository.summaries()).toEqual([]);
  });

  it('closes requests left pending by an earlier session', () => {
    const stuck = makeRecord({
      status: null,
      metadata: { requestId: 'p:9', normalizedEndpoint: '/x', pending: true },
    });
    networkRepository.upsertMany([stuck]);
    networkRepository.closeStalePending('closed');
    expect(networkRepository.get(stuck.id)).toMatchObject({
      error: 'closed',
      metadata: { pending: false },
    });
  });
});

describe('export', () => {
  it('writes valid JSON in the capture schema, redacted, with a meaningful name', async () => {
    const record = makeRecord({
      pageUrl: 'https://seller.snapdeal.com/',
      requestHeaders: {
        Authorization: 'Bearer x',
        'Content-Type': 'application/json',
      },
    });
    networkRepository.upsertMany([record]);
    const at = new Date(2026, 10, 16, 12);
    const result = await buildExport(null, false, at);
    expect(result.fileName).toBe('network-capture-snapdeal-2026-11-16.json');
    const doc = JSON.parse(result.json);
    // A bare array of records, like a desktop capture export.
    expect(Array.isArray(doc)).toBe(true);
    expect(doc).toHaveLength(1);
    expect(Object.keys(doc[0]).sort()).toEqual(Object.keys(record).sort());
    expect(doc[0].requestHeaders.Authorization).toBe(REDACTED);
    expect(doc[0].curl).toContain(`Authorization: ${REDACTED}`);
    expect(doc[0].curl).not.toContain('Bearer x');
  });

  it('exports only the selected records, unredacted when opted in', async () => {
    const a = makeRecord({ requestHeaders: { Authorization: 'Bearer a' } });
    const b = makeRecord();
    networkRepository.upsertMany([a, b]);
    const result = await buildExport([a.id], true);
    const doc = JSON.parse(result.json);
    expect(doc).toHaveLength(1);
    expect(doc[0].id).toBe(a.id);
    expect(doc[0].requestHeaders.Authorization).toBe('Bearer a');
  });

  it('labels sites sensibly', () => {
    expect(siteLabel('https://seller.flipkart.com/')).toBe('flipkart');
    expect(siteLabel('https://seller.amazon.in/')).toBe('amazon');
    expect(siteLabel('https://shop.example.co.in/')).toBe('example');
    expect(siteLabel(null)).toBe('all');
    expect(exportFileName(null, new Date(2026, 0, 5))).toBe(
      'network-capture-all-2026-01-05.json',
    );
  });
});

describe('settings', () => {
  it('starts off, with redaction on', () => {
    expect(networkSettingsStore.read()).toMatchObject({
      enabled: false,
      session: 'stopped',
      includeSensitive: false,
    });
  });

  it('turning capture off always stops the session, and the state persists', () => {
    networkSettingsStore.setEnabled(true);
    expect(networkSettingsStore.read().session).toBe('recording');
    networkSettingsStore.setSession('paused');
    networkSettingsStore.resetCacheForTest();
    expect(networkSettingsStore.read()).toMatchObject({
      enabled: true,
      session: 'paused',
    });
    networkSettingsStore.setEnabled(false);
    expect(networkSettingsStore.read().session).toBe('stopped');
    networkSettingsStore.setSession('recording');
    expect(networkSettingsStore.read().session).toBe('stopped');
  });

  it('validates and de-duplicates domains', () => {
    expect(networkSettingsStore.addDomain('not a domain', false)).toBeNull();
    networkSettingsStore.addDomain('seller.example.com', false);
    networkSettingsStore.addDomain('https://SELLER.example.com/x', true);
    expect(networkSettingsStore.read().domains).toEqual([
      { host: 'seller.example.com', includeSubdomains: true },
    ]);
    networkSettingsStore.removeDomain('seller.example.com');
    expect(networkSettingsStore.read().domains).toEqual([]);
  });
});

describe('uuid', () => {
  it('is RFC 4122 version 4', () => {
    for (let i = 0; i < 50; i++) {
      expect(uuidV4()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
