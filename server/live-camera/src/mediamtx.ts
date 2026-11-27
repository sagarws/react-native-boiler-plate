/*
 * MediaMTX, reached only from this server: its WebRTC HTTP port (WHIP/WHEP)
 * and API are never published. Every request carries basic auth with the
 * shared secret, which MediaMTX checks through our auth hook (app.ts).
 */

export const MTX_USER = 'signal';

export interface PathInfo {
  ready: boolean;
  viewers: number;
  /** Media bytes received from the publisher so far (stalls show as no growth). */
  bytesReceived: number;
}

export interface WebRtcSession {
  id: string;
  path: string;
  state: string;
}

export interface SdpResponse {
  status: number;
  sdp: string;
  /** Session secret from MediaMTX's Location header (for PATCH / DELETE). */
  session: string | null;
}

export interface MediaMtx {
  path(name: string): Promise<PathInfo | null>;
  sessions(): Promise<WebRtcSession[]>;
  kick(sessionId: string): Promise<void>;
  /** POST an SDP offer to <path>/whip or <path>/whep. */
  offer(kind: 'whip' | 'whep', path: string, sdp: string): Promise<SdpResponse>;
  /** PATCH (trickle ICE fragment) or DELETE a WHIP / WHEP session. */
  session(kind: 'whip' | 'whep', path: string, session: string, method: 'PATCH' | 'DELETE', body?: string): Promise<number>;
}

const TIMEOUT_MS = 8000;

export const createMediaMtx = (webrtcUrl: string, apiUrl: string, secret: string): MediaMtx => {
  const auth = `Basic ${Buffer.from(`${MTX_USER}:${secret}`).toString('base64')}`;
  const call = (url: string, init: RequestInit = {}) =>
    fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: auth },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  const seg = (s: string) => encodeURIComponent(s);

  return {
    async path(name) {
      const r = await call(`${apiUrl}/v3/paths/get/${seg(name)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`mediamtx api ${r.status}`);
      const j = (await r.json()) as { ready?: boolean; readers?: { type?: string }[]; bytesReceived?: number };
      return {
        ready: j.ready === true,
        viewers: (j.readers ?? []).filter(x => x.type === 'webRTCSession').length,
        bytesReceived: typeof j.bytesReceived === 'number' ? j.bytesReceived : 0,
      };
    },
    async sessions() {
      const r = await call(`${apiUrl}/v3/webrtcsessions/list?itemsPerPage=1000`);
      if (!r.ok) throw new Error(`mediamtx api ${r.status}`);
      const j = (await r.json()) as { items?: WebRtcSession[] };
      return (j.items ?? []).map(s => ({ id: s.id, path: s.path, state: s.state }));
    },
    async kick(id) {
      await call(`${apiUrl}/v3/webrtcsessions/kick/${seg(id)}`, { method: 'POST' }).catch(() => undefined);
    },
    async offer(kind, path, sdp) {
      const r = await call(`${webrtcUrl}/${seg(path)}/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: sdp,
      });
      const location = r.headers.get('location');
      return {
        status: r.status,
        sdp: await r.text(),
        session: location ? decodeURIComponent(location.split('/').filter(Boolean).pop() ?? '') || null : null,
      };
    },
    async session(kind, path, session, method, body) {
      const r = await call(`${webrtcUrl}/${seg(path)}/${kind}/${seg(session)}`, {
        method,
        headers: body ? { 'Content-Type': 'application/trickle-ice-sdpfrag', 'If-Match': '*' } : {},
        body,
      });
      await r.arrayBuffer().catch(() => undefined);
      return r.status;
    },
  };
};
