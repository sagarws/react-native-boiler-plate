import type { CapturedRequest } from '../types';
import { uuidV4 } from '../utils/uuid';

/** A complete captured call for tests; override any field. */
export function makeRecord(
  over: Partial<CapturedRequest> = {},
): CapturedRequest {
  return {
    id: uuidV4(),
    source: 'webview',
    tabId: null,
    frameId: null,
    pageUrl: 'https://seller.example.com/',
    origin: 'https://seller.example.com',
    method: 'POST',
    url: 'https://seller.example.com/omni/get',
    requestHeaders: { 'Content-Type': 'application/json' },
    requestBody: {
      kind: 'json',
      value: { name: 'x' },
      truncated: false,
      sizeBytes: 12,
    },
    status: 200,
    statusText: 'OK',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: {
      kind: 'json',
      value: { ok: true },
      truncated: false,
      sizeBytes: 11,
    },
    resourceType: 'Fetch',
    mimeType: 'application/json',
    startedAt: '2026-11-16T12:00:00.000Z',
    completedAt: '2026-11-16T12:00:01.000Z',
    durationMs: 1000,
    error: null,
    curl: '',
    metadata: {
      requestId: 'p:1',
      normalizedEndpoint: '/omni/get',
      pending: false,
    },
    ...over,
  };
}
