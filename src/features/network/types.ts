/**
 * Network Inspector domain types. `CapturedRequest` is the export schema:
 * identical on Android and iOS, with `null` wherever a value is unknown.
 */

export const HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** How a body was captured. `binary` holds base64 (`encoding: 'base64'`). */
export type BodyKind = 'json' | 'text' | 'formData' | 'binary' | 'unknown';

export interface FormDataEntry {
  name: string;
  /** Text value; null for a file part. */
  value: string | null;
  fileName?: string;
  type?: string;
  sizeBytes?: number;
}

export interface CapturedBody {
  kind: BodyKind;
  /**
   * json: the parsed value · text: the string · formData: FormDataEntry[] ·
   * binary: base64 string (or null when over the size limit) · unknown: a
   * short description string or null.
   */
  value: unknown;
  truncated: boolean;
  /** Original size, when the page exposed it; null when unknown. */
  sizeBytes: number | null;
  encoding?: 'base64';
}

/** Where in the page the request came from. */
export type ResourceType = 'Fetch' | 'XHR' | 'Beacon';

export interface CapturedRequest {
  id: string;
  /** Which engine recorded it: always the in-page instrumentation here. */
  source: 'webview';
  tabId: null;
  /** Frame URL when the request came from an iframe; null for the main frame. */
  frameId: string | null;
  pageUrl: string;
  origin: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: CapturedBody | null;
  /** null while pending or when the request failed before a response. */
  status: number | null;
  statusText: string | null;
  responseHeaders: Record<string, string>;
  responseBody: CapturedBody | null;
  resourceType: ResourceType;
  mimeType: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  /** Network error / cancellation message; null when a response arrived. */
  error: string | null;
  /** Generated with the redaction setting in force when it is read. */
  curl: string;
  metadata: {
    /** In-page id (page session + counter): the request's identity. */
    requestId: string;
    normalizedEndpoint: string;
    /** The response came in after the page had been left. */
    pending: boolean;
    /**
     * Request headers the browser adds itself (not visible to the page),
     * filled in by the recorder: reconstructed from the page (User-Agent,
     * Referer, Origin, sec-*…) or, for Cookie, read from the cookie store.
     * Absent on records captured before this was added.
     */
    inferredHeaders?: string[];
  };
}

/** The light row kept in the index for lists, search and filters. */
export interface CallSummary {
  id: string;
  method: string;
  url: string;
  host: string;
  endpoint: string;
  status: number | null;
  error: string | null;
  pending: boolean;
  durationMs: number | null;
  startedAt: string;
  pageOrigin: string;
}

export interface DomainRule {
  /** Lower-case host, optionally with :port. */
  host: string;
  includeSubdomains: boolean;
}

/** stopped → nothing recorded · recording · paused (kept until resumed). */
export type CaptureSession = 'stopped' | 'recording' | 'paused';

/**
 * allowedOnly: the request URL must also be on an allowed domain ·
 * allFromPage: every request an allowed page makes (third parties too).
 */
export type CaptureScope = 'allowedOnly' | 'allFromPage';

export const BODY_LIMITS_KB = [32, 128, 512, 1024] as const;
export type BodyLimitKb = (typeof BODY_LIMITS_KB)[number];

export interface NetworkSettings {
  enabled: boolean;
  session: CaptureSession;
  domains: DomainRule[];
  scope: CaptureScope;
  bodyLimitKb: BodyLimitKb;
  /** Off (default): tokens, cookies and passwords are redacted in copies/exports. */
  includeSensitive: boolean;
  /** Last address opened in the browser. */
  lastUrl: string;
}

export const CALL_FILTERS = [
  'all',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'success',
  'clientError',
  'serverError',
  'failed',
] as const;
export type CallFilter = (typeof CALL_FILTERS)[number];

export const DETAIL_TABS = [
  'overview',
  'requestHeaders',
  'requestBody',
  'responseHeaders',
  'responseBody',
  'curl',
] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

/** The export file: a bare JSON array of records, newest first. */
export type NetworkExport = CapturedRequest[];
