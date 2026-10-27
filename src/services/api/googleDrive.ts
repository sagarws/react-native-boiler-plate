import { ApiError, NetworkError } from './errors';

/**
 * Minimal Google Drive v3 REST client (no SDK). Feature-agnostic: callers
 * pass a token provider; this module only speaks HTTP.
 *
 * - The access token goes in the Authorization header, never in a URL.
 * - On 401 the provider is asked for a fresh token once (`refresh: true`) and
 *   the request is retried.
 * - Scope is `drive.file`: only files this app created are visible.
 */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Returns an access token; `refresh` asks for a new one (the old one was rejected). */
export type DriveTokenProvider = (refresh: boolean) => Promise<string>;

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  description?: string;
  thumbnailLink?: string;
  webViewLink?: string;
  shared?: boolean;
}

export const DRIVE_FILE_FIELDS =
  'id,name,mimeType,size,modifiedTime,description,thumbnailLink,webViewLink,shared';

type Query = Record<string, string | number | boolean | undefined>;

function withQuery(url: string, query?: Query): string {
  if (!query) return url;
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    );
  return parts.length ? `${url}?${parts.join('&')}` : url;
}

/** Google's error message from an error body, or the status text. */
function errorMessage(body: unknown, fallback: string): string {
  const message = (body as { error?: { message?: unknown } } | undefined)?.error
    ?.message;
  return typeof message === 'string' && message ? message : fallback;
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface DriveRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Path under /drive/v3 (e.g. `/files`), or an absolute URL. */
  path: string;
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
}

export function createDriveClient(getToken: DriveTokenProvider) {
  /** One authorized fetch, retried once with a fresh token on 401. */
  async function authorizedFetch(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    let token = await getToken(false);
    const send = (t: string) =>
      fetch(url, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Authorization: `Bearer ${t}`,
        },
      });
    let response: Response;
    try {
      response = await send(token);
      if (response.status === 401) {
        token = await getToken(true);
        response = await send(token);
      }
    } catch (error) {
      throw new NetworkError(
        error instanceof Error ? error.message : 'Network request failed',
        url,
      );
    }
    return response;
  }

  async function request<T>({
    method = 'GET',
    path,
    query,
    body,
    headers,
  }: DriveRequest): Promise<T> {
    const url = withQuery(
      path.startsWith('http') ? path : `${API}${path}`,
      query,
    );
    const response = await authorizedFetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined
          ? { 'Content-Type': 'application/json; charset=UTF-8' }
          : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await parse(response);
    if (!response.ok) {
      throw new ApiError(
        errorMessage(data, `Drive request failed (${response.status})`),
        {
          status: response.status,
          url,
          body: data,
        },
      );
    }
    return data as T;
  }

  /**
   * Resumable upload: metadata first (gets a session URL), then the bytes via
   * XHR so progress can be reported. [blob] comes from `fetch(uri).blob()`,
   * which React Native supports for `content://` and `file://` URIs.
   */
  async function upload(
    metadata: { name: string; parents: string[]; description?: string },
    blob: Blob,
    mimeType: string,
    onProgress?: (fraction: number) => void,
  ): Promise<DriveFile> {
    const start = await authorizedFetch(
      withQuery(`${UPLOAD}/files`, {
        uploadType: 'resumable',
        fields: DRIVE_FILE_FIELDS,
      }),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!start.ok) {
      const data = await parse(start);
      throw new ApiError(
        errorMessage(data, `Upload failed (${start.status})`),
        {
          status: start.status,
          url: `${UPLOAD}/files`,
          body: data,
        },
      );
    }
    const session =
      start.headers.get('location') ?? start.headers.get('Location');
    if (!session) {
      throw new ApiError('Upload failed: no upload session.', {
        status: start.status,
        url: `${UPLOAD}/files`,
      });
    }

    return new Promise<DriveFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', session);
      xhr.setRequestHeader('Content-Type', mimeType);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0)
          onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        let data: unknown;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = undefined;
        }
        if (xhr.status >= 200 && xhr.status < 300 && data) {
          onProgress?.(1);
          resolve(data as DriveFile);
        } else {
          reject(
            new ApiError(errorMessage(data, `Upload failed (${xhr.status})`), {
              status: xhr.status,
              url: `${UPLOAD}/files`,
              body: data,
            }),
          );
        }
      };
      xhr.onerror = () =>
        reject(new NetworkError('Upload interrupted', `${UPLOAD}/files`));
      xhr.send(blob);
    });
  }

  return { request, upload };
}

export type DriveClient = ReturnType<typeof createDriveClient>;
