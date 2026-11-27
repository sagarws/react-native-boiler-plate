import type { Access, CreatedStream, RemoteStream } from '../types';

/*
 * The streaming server's HTTP API (server/live-camera). The phone only makes
 * outbound HTTPS requests, so it works behind any NAT / CGNAT. The owner
 * token proves this phone created the stream; it never leaves memory.
 */

export class LiveApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const TIMEOUT_MS = 12_000;

async function request(
  url: string,
  init: RequestInit & { token?: string } = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const { token, headers, ...rest } = init;
  try {
    return await fetch(url, {
      ...rest,
      headers: {
        ...(headers as Record<string, string>),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } catch {
    throw new LiveApiError('network', 0);
  } finally {
    clearTimeout(timer);
  }
}

async function json<T>(r: Response): Promise<T> {
  if (r.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await r.json();
  } catch {
    /* not JSON */
  }
  if (!r.ok) {
    const code =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `http_${r.status}`;
    throw new LiveApiError(code, r.status);
  }
  return body as T;
}

export interface StreamInput {
  title?: string;
  access?: Access;
  /** Set (non-empty) to change; null removes. */
  password?: string | null;
  maxViewers?: number;
}

const jsonInit = (method: string, body: unknown, token?: string) => ({
  method,
  token,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const liveApi = {
  async health(server: string): Promise<boolean> {
    const r = await request(`${server}/healthz`);
    return r.ok;
  },

  create(server: string, input: StreamInput): Promise<CreatedStream> {
    return request(`${server}/api/streams`, jsonInit('POST', input)).then(r =>
      json<CreatedStream>(r),
    );
  },

  get(server: string, id: string, token: string): Promise<RemoteStream> {
    return request(`${server}/api/streams/${id}`, { token }).then(r =>
      json<RemoteStream>(r),
    );
  },

  update(
    server: string,
    id: string,
    token: string,
    input: StreamInput,
  ): Promise<RemoteStream> {
    return request(
      `${server}/api/streams/${id}`,
      jsonInit('PATCH', input, token),
    ).then(r => json<RemoteStream>(r));
  },

  regenerate(server: string, id: string, token: string) {
    return request(`${server}/api/streams/${id}/regenerate`, {
      method: 'POST',
      token,
    }).then(r => json<RemoteStream>(r));
  },

  revoke(server: string, id: string, token: string) {
    return request(`${server}/api/streams/${id}/revoke`, {
      method: 'POST',
      token,
    }).then(r => json<RemoteStream>(r));
  },

  async end(server: string, id: string, token: string): Promise<void> {
    await request(`${server}/api/streams/${id}`, {
      method: 'DELETE',
      token,
    }).catch(() => undefined);
  },

  /** WHIP: sends the SDP offer, returns the answer and the session URL (for DELETE). */
  async publish(
    server: string,
    whipUrl: string,
    token: string,
    offer: string,
  ): Promise<{ answer: string; session: string | null }> {
    const r = await request(whipUrl, {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/sdp' },
      body: offer,
    });
    if (r.status !== 201) await json(r); // throws with the server's code
    const location = r.headers.get('location');
    return {
      answer: await r.text(),
      session: location ? new URL(location, `${server}/`).toString() : null,
    };
  },

  async unpublish(session: string, token: string): Promise<void> {
    await request(session, { method: 'DELETE', token }).catch(() => undefined);
  },
};
