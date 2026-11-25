import {
  RTCIceCandidate,
  RTCPeerConnection,
  RTCRtpReceiver,
  RTCRtpSender,
  type RTCRtpTransceiver,
} from 'react-native-webrtc';
import { REMOTE_SERVER } from '../core/constants';
import { onRelayIce, type IceGrant } from '../core/relay';
import type { IceServer, RemoteSettings, SignalMessage } from '../types';

/** WebRTC helpers shared by the viewer and the host (desktop: renderer/remote/rtc.ts). */

/** The newest TURN login from the relay, until it expires. */
let relayTurn: IceGrant | null = null;
onRelayIce(grant => {
  relayTurn = grant;
});

/**
 * WebRTC tries a direct path first (same network, then through both NATs with
 * STUN) and only sends video through TURN when nothing direct works. TURN, in
 * order: this phone's own setting, a login from the relay, the built-in one.
 */
export const iceServersFor = (settings: RemoteSettings): IceServer[] => {
  if (settings.turnUrl) {
    return [
      {
        urls: settings.turnUrl,
        ...(settings.turnUsername ? { username: settings.turnUsername } : {}),
        ...(settings.turnCredential
          ? { credential: settings.turnCredential }
          : {}),
      },
    ];
  }
  const servers: IceServer[] = REMOTE_SERVER.stun.length
    ? [{ urls: [...REMOTE_SERVER.stun] }]
    : [];
  const turn =
    relayTurn && relayTurn.expiresAt - Date.now() > 60_000
      ? relayTurn
      : REMOTE_SERVER.turn;
  if (turn)
    servers.push({
      urls: [...turn.urls],
      username: turn.username,
      credential: turn.credential,
    });
  return servers;
};

export const newPeerConnection = (iceServers: IceServer[]): RTCPeerConnection =>
  new RTCPeerConnection({
    iceServers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });

type Codec = { mimeType: string; clockRate: number; sdpFmtpLine?: string };

/**
 * H.264 first (hardware decoders on phones), then VP9, VP8. The answer's
 * order decides what the host encodes. Best effort: an engine that refuses
 * the list keeps its own order.
 */
export const preferH264 = (transceiver: RTCRtpTransceiver): void => {
  if (typeof transceiver.setCodecPreferences !== 'function') return;
  const order = ['video/H264', 'video/VP9', 'video/VP8'];
  const rank = (c: Codec): number => {
    const index = order.indexOf(c.mimeType);
    if (index < 0) return 100;
    const fmtp = c.sdpFmtpLine ?? '';
    return (
      index * 10 +
      (fmtp.includes('packetization-mode=1') ? 0 : 2) +
      (fmtp.includes('profile-level-id=42e0') ? 0 : 1)
    );
  };
  const receive = (RTCRtpReceiver.getCapabilities('video')?.codecs ??
    []) as unknown as Codec[];
  const send = (RTCRtpSender.getCapabilities('video')?.codecs ??
    []) as unknown as Codec[];
  for (const list of [receive, send]) {
    if (!list.length) continue;
    try {
      transceiver.setCodecPreferences(
        [...list].sort((a, b) => rank(a) - rank(b)) as never,
      );
      return;
    } catch {
      // try the next list
    }
  }
};

export const candidateSignal = (c: {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}): SignalMessage => ({
  type: 'candidate',
  candidate: c.candidate,
  sdpMid: c.sdpMid ?? null,
  sdpMLineIndex: c.sdpMLineIndex ?? null,
});

/** Holds ICE candidates that arrive before the remote description. */
export class CandidateQueue {
  private queue: RTCIceCandidate[] = [];
  constructor(private readonly pc: () => RTCPeerConnection | null) {}

  add(signal: Extract<SignalMessage, { type: 'candidate' }>): void {
    const candidate = new RTCIceCandidate({
      candidate: signal.candidate,
      sdpMid: signal.sdpMid ?? undefined,
      sdpMLineIndex: signal.sdpMLineIndex ?? undefined,
    });
    const pc = this.pc();
    if (pc?.remoteDescription)
      void pc.addIceCandidate(candidate).catch(() => undefined);
    else this.queue.push(candidate);
  }

  flush(): void {
    const pc = this.pc();
    if (!pc) return;
    for (const c of this.queue.splice(0))
      void pc.addIceCandidate(c).catch(() => undefined);
  }

  clear(): void {
    this.queue = [];
  }
}

const MAX_SDP = 256 * 1024;

/** A WebRTC signal from the other device, checked before use. */
export const parseSignal = (raw: unknown): SignalMessage | null => {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (
    (v.type === 'offer' || v.type === 'answer') &&
    typeof v.sdp === 'string' &&
    v.sdp.length <= MAX_SDP
  )
    return { type: v.type, sdp: v.sdp };
  if (
    v.type === 'candidate' &&
    typeof v.candidate === 'string' &&
    v.candidate.length <= 2048
  ) {
    const mid = v.sdpMid;
    const index = v.sdpMLineIndex;
    return {
      type: 'candidate',
      candidate: v.candidate,
      sdpMid: typeof mid === 'string' && mid.length <= 64 ? mid : null,
      sdpMLineIndex:
        typeof index === 'number' &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < 64
          ? index
          : null,
    };
  }
  if (v.type === 'restart') return { type: 'restart' };
  return null;
};
