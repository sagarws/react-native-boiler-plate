import { getApiBaseUrl } from '@/config';
import { logger } from '@/shared/utils';
import { ApiError, NetworkError, TimeoutError } from './errors';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type RequestOptions = {
  method?: HttpMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 15_000;

type TokenProvider = () => Promise<string | undefined> | string | undefined;

let tokenProvider: TokenProvider | undefined;

export function setAuthTokenProvider(provider: TokenProvider | undefined) {
  tokenProvider = provider;
}

/** The current bearer token, for callers that build their own `fetch`. */
export async function getAuthToken(): Promise<string | undefined> {
  return tokenProvider?.();
}

/**
 * The response envelope the backend wraps every payload in, on success and on
 * failure alike. `isSuccess: false` can arrive with a 2xx status, so callers
 * must check the flag rather than trusting `response.ok` — `requestData`
 * below does that in one place. Adapt this shape to your backend's contract.
 */
export interface ApiEnvelope<T> {
  isSuccess: boolean;
  message?: string;
  /** User-facing copy. Safe to surface in the UI as-is. */
  displayMessage?: string;
  data: T;
}

async function buildHeaders(custom?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...custom,
  };
  const token = await getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function request<TResponse>(options: RequestOptions): Promise<TResponse> {
  const {
    method = 'GET',
    path,
    body,
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options;
  const url = `${getApiBaseUrl()}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort());

  try {
    const response = await fetch(url, {
      method,
      headers: await buildHeaders(headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const parsed = await parseBody(response);

    if (!response.ok) {
      const errBody = parsed as { displayMessage?: string; message?: string } | undefined;
      const summary = [
        `${method} ${path}`,
        `${response.status}`,
        errBody?.displayMessage ?? errBody?.message,
      ]
        .filter(Boolean)
        .join(' · ');
      const err = new ApiError(summary, {
        status: response.status,
        url,
        body: parsed,
      });
      logger.error(err);
      throw err;
    }

    return parsed as TResponse;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { name?: string }).name === 'AbortError') {
      const timeoutErr = new TimeoutError(url);
      logger.error(timeoutErr);
      throw timeoutErr;
    }
    const netErr = new NetworkError(
      error instanceof Error ? error.message : 'Unknown network error',
      url,
    );
    logger.error(netErr);
    throw netErr;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Runs a request and unwraps the `ApiEnvelope`, converting
 * `isSuccess: false` into an ApiError carrying the server's `displayMessage`
 * so callers get one failure channel instead of two.
 */
export async function requestData<T>(options: RequestOptions): Promise<T> {
  const envelope = await request<ApiEnvelope<T>>(options);
  if (envelope && envelope.isSuccess === false) {
    const err = new ApiError(
      envelope.displayMessage ?? envelope.message ?? 'Request failed',
      { status: 200, url: options.path, body: envelope },
    );
    logger.error(err);
    throw err;
  }
  return envelope?.data as T;
}

export const apiClient = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
    request<T>({ ...opts, path, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>) =>
    request<T>({ ...opts, path, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>) =>
    request<T>({ ...opts, path, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>) =>
    request<T>({ ...opts, path, method: 'PATCH', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
    request<T>({ ...opts, path, method: 'DELETE' }),
  /** Envelope-unwrapping variants — the default for backend endpoints. */
  getData: <T>(path: string, opts?: Omit<RequestOptions, 'path' | 'method'>) =>
    requestData<T>({ ...opts, path, method: 'GET' }),
  postData: <T>(
    path: string,
    body?: unknown,
    opts?: Omit<RequestOptions, 'path' | 'method' | 'body'>,
  ) => requestData<T>({ ...opts, path, method: 'POST', body }),
};
