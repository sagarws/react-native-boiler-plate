import { MediaStream, type RTCPeerConnection } from 'react-native-webrtc';
import { toBase64 } from '../core/bytes';
import type { Channel, Received, WireMessage } from '../core/channel';
import {
  KEEPALIVE_MS,
  LINK_TIMEOUT_MS,
  RESUME_WINDOW_MS,
} from '../core/constants';
import {
  runClientHandshake,
  type Granted,
  type HostInfo,
} from '../core/handshake';
import { cleanText } from '../core/ids';
import type {
  IceServer,
  InputEvent,
  QualityPreset,
  QualityPriority,
  RemoteDisplay,
  RemotePermission,
  SignalMessage,
} from '../types';
import { dial, type Route } from './dial';
import { localIdentity } from './identity';
import {
  CandidateQueue,
  candidateSignal,
  newPeerConnection,
  parseSignal,
  preferH264,
} from './rtc';

/*
 * One outgoing session on this phone (the controller): the encrypted channel
 * to the host, the WebRTC answerer that receives the screen and sends input
 * over the host's "input" (ordered) and "move" (unordered) data channels, and
 * resuming with the session token after a network drop — the desktop's
 * ViewerSession + useRemoteConnection in one.
 */

export type ViewerState = 'active' | 'reconnecting' | 'ended';
export type MediaState = 'connecting' | 'connected' | 'interrupted';

export type ViewerNotice =
  | { kind: 'timer' }
  | { kind: 'warning'; minutes: number }
  | { kind: 'permission'; permission: RemotePermission }
  | { kind: 'message'; text: string }
  | { kind: 'reconnected' };

export interface ViewerSnapshot {
  sessionId: string;
  host: HostInfo;
  via: 'lan' | 'relay';
  state: ViewerState;
  media: MediaState;
  streamURL: string | null;
  permission: RemotePermission;
  expiresAt: number | null;
  displays: RemoteDisplay[];
  displayId: string;
  quality: QualityPreset;
  priority: QualityPriority;
  inputProblem: string | null;
  locked: boolean;
  /** JPEG of the host's lock screen (Windows agent), as a data URI. */
  lockFrame: string | null;
  notice: ViewerNotice | null;
  endReason: string | null;
  rttMs: number | null;
  startedAt: number;
}

const parseDisplays = (raw: unknown): RemoteDisplay[] =>
  Array.isArray(raw)
    ? raw
        .slice(0, 16)
        .map(d => d as Record<string, unknown>)
        .filter(d => d && typeof d.id === 'string')
        .map(d => ({
          id: String(d.id).slice(0, 64),
          label: cleanText(d.label, 64) || 'Display',
          primary: d.primary === true,
          width: Number(d.width) || 0,
          height: Number(d.height) || 0,
          scaleFactor: Number(d.scaleFactor) || 1,
        }))
    : [];

type DataChannel = {
  label: string;
  readyState: string;
  send(data: string): void;
  addEventListener: (
    type: 'message',
    cb: (e: { data: unknown }) => void,
  ) => void;
};

export interface ViewerEvents {
  onChange: () => void;
  onEnded: (session: ViewerSession, reason: string) => void;
  onReconnected: (session: ViewerSession) => void;
}

export class ViewerSession {
  readonly id: string;
  private snap: ViewerSnapshot;
  private channel: Channel | null;
  private resumeToken: Uint8Array;
  private pc: RTCPeerConnection | null = null;
  private input: DataChannel | null = null;
  private move: DataChannel | null = null;
  private readonly candidates = new CandidateQueue(() => this.pc);
  private ticker: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private ticks = 0;
  private moveSeq = 0;
  private pingSentAt = 0;

  constructor(
    host: HostInfo,
    granted: Granted,
    channel: Channel,
    private readonly route: Route,
    private readonly iceServers: IceServer[],
    quality: QualityPreset,
    priority: QualityPriority,
    private readonly events: ViewerEvents,
  ) {
    this.id = granted.sessionId;
    this.channel = channel;
    this.resumeToken = granted.resumeToken;
    const displays = parseDisplays(granted.raw.displays);
    this.snap = {
      sessionId: granted.sessionId,
      host,
      via: route.kind === 'relay' ? 'relay' : 'lan',
      state: 'active',
      media: 'connecting',
      streamURL: null,
      permission: granted.permission,
      expiresAt:
        granted.expiresInMs === null ? null : Date.now() + granted.expiresInMs,
      displays,
      displayId:
        typeof granted.raw.displayId === 'string'
          ? granted.raw.displayId
          : displays[0]?.id ?? '',
      quality,
      priority,
      inputProblem:
        typeof granted.raw.inputProblem === 'string'
          ? cleanText(granted.raw.inputProblem, 300)
          : null,
      locked: granted.raw.locked === true,
      lockFrame: null,
      notice: null,
      endReason: null,
      rttMs: null,
      startedAt: Date.now(),
    };
  }

  /** Read fresh: `set` replaces the snapshot while awaits are pending. */
  private stateNow(): ViewerState {
    return this.snap.state;
  }

  get snapshot(): ViewerSnapshot {
    return this.snap;
  }

  private set(patch: Partial<ViewerSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.events.onChange();
  }

  start(): void {
    this.attach(this.channel!);
    this.ticker = setInterval(() => this.tick(), 1000);
    // The host starts the screen once the viewer says it is ready.
    if (this.snap.quality !== 'auto')
      this.send({
        t: 'quality',
        preset: this.snap.quality,
        priority: this.snap.priority,
      });
    this.send({ t: 'viewer-ready' });
  }

  private attach(channel: Channel): void {
    this.channel = channel;
    channel.onClose(() => {
      if (this.channel === channel) void this.reconnect();
    });
    channel.startPushMode(item => this.onMessage(item));
  }

  private send(msg: WireMessage): boolean {
    return this.channel?.send(msg) ?? false;
  }

  private onMessage({ msg, binary }: Received): void {
    if (this.snap.state === 'ended') return;
    switch (msg.t) {
      case 'ping':
        return;
      case 'signal': {
        const signal = parseSignal(msg.data);
        if (signal) this.onSignal(signal);
        return;
      }
      case 'timer': {
        const ms = msg.expiresInMs;
        return this.set({
          expiresAt: typeof ms === 'number' && ms > 0 ? Date.now() + ms : null,
          notice: { kind: 'timer' },
        });
      }
      case 'warning':
        return this.set({
          notice: {
            kind: 'warning',
            minutes: Math.ceil((Number(msg.remainingMs) || 0) / 60_000),
          },
        });
      case 'permission': {
        const permission: RemotePermission =
          msg.permission === 'control' ? 'control' : 'view';
        return this.set({
          permission,
          notice: { kind: 'permission', permission },
        });
      }
      case 'input-status':
        return this.set({
          inputProblem:
            typeof msg.problem === 'string'
              ? cleanText(msg.problem, 300)
              : null,
        });
      case 'displays': {
        const displays = parseDisplays(msg.displays);
        return this.set({
          displays,
          displayId:
            typeof msg.current === 'string' ? msg.current : this.snap.displayId,
        });
      }
      case 'locked':
        return this.set({
          locked: msg.locked === true,
          lockFrame: msg.locked === true ? this.snap.lockFrame : null,
        });
      case 'secure-frame': {
        if (!binary || binary.length > 4 * 1024 * 1024) return;
        return this.set({
          lockFrame: `data:image/jpeg;base64,${toBase64(binary)}`,
        });
      }
      case 'notice':
        return this.set({
          notice: { kind: 'message', text: cleanText(msg.message, 300) },
        });
      case 'end':
        return this.end(
          typeof msg.reason === 'string' ? cleanText(msg.reason, 300) : '',
          false,
        );
      default:
        return;
    }
  }

  // ── WebRTC (the host offers; every offer gets a fresh connection) ──

  private onSignal(signal: SignalMessage): void {
    if (signal.type === 'offer') {
      this.set({ media: 'connecting' });
      void this.answer(signal.sdp).catch(() => this.requestRestart());
    } else if (signal.type === 'candidate') this.candidates.add(signal);
  }

  private closePc(): void {
    this.pc?.close();
    this.pc = null;
    this.input = null;
    this.move = null;
    this.candidates.clear();
  }

  private async answer(sdp: string): Promise<void> {
    this.closePc();
    const pc = newPeerConnection(this.iceServers);
    this.pc = pc;
    pc.addEventListener('track', event => {
      if (this.pc !== pc) return;
      // The desktop host sends its track without a stream (addTransceiver
      // with no `streams`), so `streams` is empty: wrap the track in one,
      // or RTCView has nothing to show (black screen, video still arriving).
      const given = (event.streams?.[0] ?? null) as MediaStream | null;
      const track = event.track;
      const stream =
        given ??
        (track && track.kind === 'video' ? new MediaStream([track]) : null);
      if (stream) this.set({ streamURL: stream.toURL() });
    });
    pc.addEventListener('datachannel', event => {
      const channel = event.channel as unknown as DataChannel;
      if (channel.label === 'input') {
        this.input = channel;
        channel.addEventListener('message', e => {
          if (typeof e.data !== 'string') return;
          try {
            const m = JSON.parse(e.data) as { k?: string; t?: number };
            if (m.k === 'pong' && typeof m.t === 'number')
              this.set({ rttMs: Math.round(Date.now() - m.t) });
          } catch {
            // ignore
          }
        });
      } else if (channel.label === 'move') this.move = channel;
    });
    pc.addEventListener('icecandidate', event => {
      const c = event.candidate;
      if (c && this.pc === pc)
        this.send({ t: 'signal', data: candidateSignal(c) });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      const state = pc.connectionState;
      if (state === 'connected') this.set({ media: 'connected' });
      else if (state === 'disconnected') this.set({ media: 'interrupted' });
      else if (state === 'failed') {
        this.set({ media: 'interrupted' });
        this.requestRestart();
      }
    });
    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const transceiver of pc.getTransceivers()) {
      if (transceiver.receiver.track?.kind === 'video') preferH264(transceiver);
    }
    this.candidates.flush();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({ t: 'signal', data: { type: 'answer', sdp: answer.sdp ?? '' } });
  }

  /** The video failed: ask the host for a fresh offer. */
  private requestRestart(): void {
    if (this.restartTimer || this.snap.state === 'ended') return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.send({ t: 'viewer-ready' });
    }, 2500);
  }

  // ── controls ──

  get canControl(): boolean {
    return (
      this.snap.permission === 'control' &&
      this.snap.state === 'active' &&
      this.snap.media === 'connected'
    );
  }

  /** Clicks, keys, wheel, text: ordered and reliable. */
  sendInput(event: InputEvent): void {
    if (!this.canControl) return;
    if (this.input?.readyState === 'open')
      this.input.send(JSON.stringify(event));
  }

  /** Pointer moves: unordered, never retransmitted — a newer move replaces a lost one. */
  sendMove(x: number, y: number): void {
    if (!this.canControl) return;
    const channel = this.move?.readyState === 'open' ? this.move : this.input;
    if (channel?.readyState === 'open')
      channel.send(JSON.stringify({ k: 'mm', x, y, s: ++this.moveSeq }));
  }

  setDisplay(id: string): void {
    if (
      !this.snap.displays.some(d => d.id === id) ||
      id === this.snap.displayId
    )
      return;
    this.send({ t: 'display', id });
  }

  setQuality(
    quality: QualityPreset,
    priority: QualityPriority = this.snap.priority,
  ): void {
    this.set({ quality, priority });
    this.send({ t: 'quality', preset: quality, priority });
  }

  /** Ctrl+Alt+Delete on a locked Windows host (its lock-screen agent). */
  sendCtrlAltDel(): void {
    if (this.snap.permission === 'control' && this.snap.locked)
      this.send({ t: 'secure-sas' });
  }

  clearNotice(): void {
    if (this.snap.notice) this.set({ notice: null });
  }

  private tick(): void {
    if (this.snap.state !== 'active' || !this.channel) return;
    this.ticks++;
    if ((this.ticks * 1000) % KEEPALIVE_MS === 0) this.send({ t: 'ping' });
    if (Date.now() - this.channel.lastReceivedAt > LINK_TIMEOUT_MS) {
      this.channel.close('No answer from the other device.');
      return;
    }
    // Input round trip, shown in the toolbar.
    if (
      this.input?.readyState === 'open' &&
      Date.now() - this.pingSentAt >= 2000
    ) {
      this.pingSentAt = Date.now();
      this.input.send(JSON.stringify({ k: 'ping', t: this.pingSentAt }));
    }
  }

  // ── reconnect ──

  private async reconnect(): Promise<void> {
    if (this.snap.state !== 'active') return;
    this.channel = null;
    this.closePc();
    this.set({ state: 'reconnecting', media: 'interrupted' });
    const deadline = Date.now() + RESUME_WINDOW_MS;
    while (Date.now() < deadline && this.stateNow() === 'reconnecting') {
      try {
        const stream = await dial(this.route, 3000);
        const result = await runClientHandshake(stream, {
          identity: localIdentity(),
          purpose: 'resume',
          expectedId: this.snap.host.id,
          pinnedFingerprint: this.snap.host.fingerprint,
          resume: { sessionId: this.id, token: this.resumeToken },
        });
        if (this.stateNow() !== 'reconnecting' || !result.granted) {
          result.channel.close();
          return;
        }
        const granted = result.granted;
        this.resumeToken = granted.resumeToken;
        this.set({
          state: 'active',
          permission: granted.permission,
          expiresAt:
            granted.expiresInMs === null
              ? null
              : Date.now() + granted.expiresInMs,
          locked: granted.raw.locked === true,
          notice: { kind: 'reconnected' },
        });
        this.attach(result.channel);
        this.send({ t: 'viewer-ready' });
        this.events.onReconnected(this);
        return;
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code && code !== 'network' && code !== 'timeout') {
          return this.end(error instanceof Error ? error.message : '', false);
        }
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
      }
    }
    if (this.stateNow() === 'reconnecting') this.end('lost', false);
  }

  /** You pressed Disconnect. */
  disconnect(): void {
    if (this.snap.state === 'ended') return;
    this.channel?.closeAfter({ t: 'bye' });
    this.channel = null;
    this.end('you', false);
  }

  /** reason: the host's text, or 'you' / 'lost' for the phone's own wording. */
  end(reason: string, notifyHost = true): void {
    if (this.snap.state === 'ended') return;
    if (this.ticker) clearInterval(this.ticker);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (notifyHost) this.channel?.closeAfter({ t: 'bye' });
    else this.channel?.close('Ended.');
    this.channel = null;
    this.closePc();
    this.set({
      state: 'ended',
      endReason: reason,
      streamURL: null,
      media: 'interrupted',
    });
    this.events.onEnded(this, reason);
  }
}
