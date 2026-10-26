import { getApiBaseUrl } from '@/config';
import { logger } from '@/shared/utils';
import { getAuthToken } from './client';
import { ApiError, NetworkError } from './errors';

export interface UploadedFile {
  url: string;
}

interface LocalFile {
  uri: string;
  name?: string;
  type?: string;
}

function inferName(uri: string): string {
  const segment = uri.split('/').pop() ?? `file-${Date.now()}.jpg`;
  return segment.includes('.') ? segment : `${segment}.jpg`;
}

function inferType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'application/octet-stream';
}

// Example multipart upload: POST /api/upload with field name "files". Adjust
// the path and field names to your backend. Bypasses the JSON apiClient so RN
// can set the multipart boundary itself, but uses the same token provider and
// base URL, so the dev endpoint override keeps working.
export async function uploadFiles(
  files: LocalFile[],
  options: { folder?: string } = {},
): Promise<UploadedFile[]> {
  if (files.length === 0) return [];

  const form = new FormData();
  files.forEach(f => {
    const name = f.name ?? inferName(f.uri);
    const type = f.type ?? inferType(name);
    // RN's FormData supports the { uri, name, type } object — TS lib doesn't.
    form.append('files', { uri: f.uri, name, type } as unknown as Blob);
  });
  if (options.folder) form.append('folder', options.folder);

  const token = await getAuthToken();
  const url = `${getApiBaseUrl()}/api/upload`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
    });
  } catch (err) {
    const netErr = new NetworkError(
      err instanceof Error ? err.message : 'Upload failed',
      url,
    );
    logger.error(netErr);
    throw netErr;
  }

  const text = await response.text();
  const parsed = text ? safeJson(text) : undefined;

  if (!response.ok) {
    const body = parsed as { code?: string; message?: string } | undefined;
    const err = new ApiError(
      `POST /api/upload · ${response.status} · ${body?.code ?? ''} · ${
        body?.message ?? ''
      }`,
      { status: response.status, url, body: parsed },
    );
    logger.error(err);
    throw err;
  }

  const envelope = parsed as { data?: UploadedFile[] } | undefined;
  return envelope?.data ?? [];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Convenience for image-only callers — discards the {url} wrapper.
export async function uploadImages(
  uris: string[],
  options: { folder?: string } = {},
): Promise<string[]> {
  const uploaded = await uploadFiles(
    uris.map(uri => ({ uri })),
    options,
  );
  return uploaded.map(u => u.url);
}
