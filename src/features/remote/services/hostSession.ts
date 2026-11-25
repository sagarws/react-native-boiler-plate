import {
  mediaDevices,
  type MediaStream,
  type RTCPeerConnection,
} from 'react-native-webrtc';
import { hexOf } from '../core/bytes';
import type { Channel, Received, WireMessage } from '../core/channel';
import {
  EXPIRY_WARNING_MS,
  KEEPALIVE_MS,
  LINK_TIMEOUT_MS,
  RESUME_WINDOW_MS,
} from '../core/constants';
import { randomToken } from '../core/crypto';
import type { GrantPayload, PeerInfo } from '../core/handshake';
import { parseInputEvent } from '../core/input';
import type {
  IceServer,
  QualityPreset,
  RemoteDisplay,
  RemotePermission,
  SessionMinutes,
} from '../types';
import { HostInput } from './hostInput';
import { remoteNative, type ScreenInfo } from './native.service';
import {
  CandidateQueue,
  candidateSignal,
  newPeerConnection,
  parseSignal,
} from './rtc';

/*
 * One incoming session on this phone (the one being controlled). Enforces
 * what the session may do — input only while active, unexpired and
 * full-control, checked for every event — shares the screen over WebRTC
 * (Android's capture consent, then react-native-webrtc's mediaProjection
 * foreground service), keeps the time limit, and holds the session for 30 s
 * after a dropped connection so the controller can resume.
 */

export const SCREEN_DISPLAY_ID = 'screen';

export type HostSessionState = 'starting' | 'active' | 'reconnecting' | 'ended';

export interface HostSessionSnapshot {
  sessionId: string;
  peer: { id: string; name: string; os: string };
  method: 'password' | 'attended';
  permission: RemotePermission;
  state: HostSessionState;
  startedAt: number;
  expiresAt: number | null;
  sharing: boolean;
  controlReady: boolean;
}

/**
 * While the video goes through the TURN server (no direct path between the
 * networks), cap it: that server's bandwidth is shared by every relayed session.
 */
const RELAYED_MAX_BITRATE = 2_500_000;
const RELAYED_MAX_FPS = 30;
const ROUTE_CHECK_MS = 3000;

/** Encoder ceilings per preset (the desktop's QUALITY_PROFILES, phone-sized). */
const QUALITY: Record<
  QualityPreset,
  { height: number | null; fps: number; bitrate: number }
> = {
  'ultra-low': { height: 480, fps: 12, bitrate: 500_000 },
  low: { height: 720, fps: 18, bitrate: 1_500_000 },
  balanced: { height: 900, fps: 30, bitrate: 3_000_000 },
  high: { height: 1080, fps: 30, bitrate: 6_000_000 },
  ultra: { height: null, fps: 60, bitrate: 10_000_000 },
  auto: { height: 1080, fps: 30, bitrate: 6_000_000 },
};

type DataChannel = {
  readyState: string;
  send(data: string): void;
  addEventListener: (
    type: 'message',
    cb: (e: { data: unknown }) => void,
  ) => void;
};

export interface HostSessionEvents {
  onChange: () => void;
  onEnded: (session: HostSession, reason: string) => void;
  controlServiceEnabled: () => boolean;
  iceServers: () => IceServer[];
}

export class HostSession {
  readonly id = hexOf(randomToken(16));
  readonly startedAt = Date.now();
  resumeToken = randomToken();
  state: HostSessionState = 'starting';
  permission: RemotePermission;
  expiresAt: number | null;
  private channel: Channel | null;
  private pc: RTCPeerConnection | null = null;
  private stream: MediaStream | null = null;
  private readonly candidates = new CandidateQueue(() => this.pc);
  private readonly input: HostInput;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastPingAt = 0;
  private warned = false;
  private suspendedAt = 0;
  private quality: QualityPreset = 'auto';
  /** Is the video going through TURN right now? */
  private relayed = false;
  private routeCheckedAt = 0;
  private screen: ScreenInfo | null = null;
  private lastMoveSeq = -1;

  constructor(
    readonly peer: PeerInfo,
    readonly method: 'password' | 'attended',
    permission: RemotePermission,
    minutes: SessionMinutes,
    channel: Channel,
    private readonly events: HostSessionEvents,
  ) {
    this.permission = permission;
    this.expiresAt = minutes > 0 ? this.startedAt + minutes * 60_000 : null;
    this.channel = channel;
    this.input = new HostInput({
      pointer: (action, x, y, b) => remoteNative.pointer(action, x, y, b),
      scroll: (x, y, dx, dy) => remoteNative.scroll(x, y, dx, dy),
      globalAction: name => {
        remoteNative.globalAction(name).catch(() => undefined);
      },
      typeText: text => {
        remoteNative.typeText(text).catch(() => undefined);
      },
      editAction: name => {
        remoteNative.editAction(name).catch(() => undefined);
      },
    });
  }

  snapshot(): HostSessionSnapshot {
    return {
      sessionId: this.id,
      peer: { id: this.peer.id, name: this.peer.name, os: this.peer.os },
      method: this.method,
      permission: this.permission,
      state: this.state,
      startedAt: this.startedAt,
      expiresAt: this.expiresAt,
      sharing: this.stream !== null,
      controlReady: this.events.controlServiceEnabled(),
    };
  }

  private async displays(): Promise<RemoteDisplay[]> {
    this.screen = this.screen ?? (await remoteNative.screenInfo());
    return [
      {
        id: SCREEN_DISPLAY_ID,
        label: 'Phone screen',
        primary: true,
        width: this.screen?.width ?? 1080,
        height: this.screen?.height ?? 2400,
        scaleFactor: this.screen?.density ?? 1,
      },
    ];
  }

  private inputProblem(): string | null {
    return this.events.controlServiceEnabled()
      ? null
      : 'Remote control is off on the phone (Android Accessibility → Akshar Remote Access). You can view the screen.';
  }

  /** Sent with 'granted' (and again on resume). */
  async grantPayload(onSent: () => void): Promise<GrantPayload> {
    return {
      sessionId: this.id,
      resumeToken: this.resumeToken,
      permission: this.permission,
      expiresInMs:
        this.expiresAt === null
          ? null
          : Math.max(1, this.expiresAt - Date.now()),
      extra: {
        displays: await this.displays(),
        displayId: SCREEN_DISPLAY_ID,
        clipboard: false,
        fileTransfer: false,
        hostPlatform: 'android',
        inputProblem: this.inputProblem(),
        locked: false,
        secureAgent: false,
      },
      onSent,
    };
  }

  /** The 'granted' went out: take the channel over. */
  begin(): void {
    this.state = 'active';
    this.attach(this.channel!);
    this.ticker = setInterval(() => this.tick(), 1000);
    this.events.onChange();
  }

  private attach(channel: Channel): void {
    this.channel = channel;
    channel.onClose(() => {
      if (this.channel === channel) this.suspend();
    });
    channel.startPushMode(item => this.onMessage(item));
  }

  private send(msg: WireMessage): void {
    this.channel?.send(msg);
  }

  private onMessage({ msg }: Received): void {
    if (this.state === 'ended') return;
    // React Native pauses JS timers while the app is in the background — and
    // a controlled phone is usually showing another app. The controller pings
    // every 2 s, so its traffic drives the keepalive and the time limit too.
    this.tick();
    if (this.isEnded()) return;
    switch (msg.t) {
      case 'bye':
        return this.end('The other device disconnected.', false);
      case 'viewer-ready':
        void this.negotiate();
        return;
      case 'signal': {
        const signal = parseSignal(msg.data);
        if (!signal || !this.pc) return;
        if (signal.type === 'answer') {
          void this.pc
            .setRemoteDescription({ type: 'answer', sdp: signal.sdp })
            .then(() => {
              this.candidates.flush();
              return this.applyQuality();
            })
            .catch(() =>
              this.send({
                t: 'notice',
                message: 'Could not start the stream.',
              }),
            );
        } else if (signal.type === 'candidate') this.candidates.add(signal);
        return;
      }
      case 'quality': {
        const preset = msg.preset as QualityPreset;
        if (!(preset in QUALITY)) return;
        this.quality = preset;
        void this.applyQuality();
        return;
      }
      default:
        return;
    }
  }

  // ── screen ──

  private async capture(): Promise<MediaStream> {
    if (this.stream) return this.stream;
    // Android shows its own "Start recording or casting?" consent here.
    const stream = await mediaDevices.getDisplayMedia({ video: true } as never);
    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (this.state !== 'ended')
          this.end('Screen sharing was stopped on the phone.');
      });
    }
    this.events.onChange();
    return stream;
  }

  private closePc(): void {
    this.pc?.close();
    this.pc = null;
    this.candidates.clear();
  }

  private async negotiate(): Promise<void> {
    this.closePc();
    this.lastMoveSeq = -1;
    let stream: MediaStream;
    try {
      stream = await this.capture();
    } catch {
      this.end('The phone did not allow screen sharing.');
      return;
    }
    if (this.state === 'ended') return;
    const pc = newPeerConnection(this.events.iceServers());
    this.pc = pc;
    const track = stream.getVideoTracks()[0];
    if (track)
      pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [stream],
      } as never);
    const ordered = pc.createDataChannel('input', {
      ordered: true,
    }) as unknown as DataChannel;
    const move = pc.createDataChannel('move', {
      ordered: false,
      maxRetransmits: 0,
    }) as unknown as DataChannel;
    for (const channel of [ordered, move])
      channel.addEventListener('message', e => this.onData(channel, e.data));
    pc.addEventListener('icecandidate', event => {
      if (event.candidate && this.pc === pc)
        this.send({ t: 'signal', data: candidateSignal(event.candidate) });
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc === pc && pc.connectionState === 'connected')
        void this.applyQuality();
    });
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    this.send({ t: 'signal', data: { type: 'offer', sdp: offer.sdp ?? '' } });
  }

  private async applyQuality(): Promise<void> {
    const sender = this.pc?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    const plan = QUALITY[this.quality];
    const screen = this.screen;
    const tall = screen ? Math.max(screen.width, screen.height) : 2400;
    const scale = plan.height && tall > plan.height ? tall / plan.height : 1;
    try {
      const params = sender.getParameters();
      const encodings = params.encodings?.length
        ? params.encodings
        : [{} as never];
      const encoding = encodings[0] as unknown as Record<string, unknown>;
      encoding.maxBitrate = this.relayed
        ? Math.min(plan.bitrate, RELAYED_MAX_BITRATE)
        : plan.bitrate;
      encoding.maxFramerate = this.relayed
        ? Math.min(plan.fps, RELAYED_MAX_FPS)
        : plan.fps;
      encoding.scaleResolutionDownBy = scale;
      await sender.setParameters(params);
    } catch {
      // Some encoders ignore parameters; congestion control still applies.
    }
  }

  // ── input (checked per event) ──

  private canControl(): boolean {
    return (
      this.state === 'active' &&
      this.permission === 'control' &&
      (this.expiresAt === null || Date.now() < this.expiresAt) &&
      this.events.controlServiceEnabled()
    );
  }

  private onData(channel: DataChannel, data: unknown): void {
    if (typeof data !== 'string' || data.length > 16_384) return;
    let msg: unknown;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const m = msg as Record<string, unknown>;
    if (!Array.isArray(msg) && m.k === 'ping') {
      if (channel.readyState === 'open')
        channel.send(JSON.stringify({ k: 'pong', t: m.t }));
      return;
    }
    if (!this.canControl()) return;
    const list = Array.isArray(msg) ? msg.slice(0, 64) : [msg];
    for (const raw of list) {
      const r = raw as Record<string, unknown>;
      if (r?.k === 'mm' && typeof r.s === 'number') {
        // Unordered channel: an older move arriving late is dropped.
        if (r.s <= this.lastMoveSeq) continue;
        this.lastMoveSeq = r.s;
      }
      const event = parseInputEvent(raw);
      if (event) this.input.handle(event);
    }
  }

  // ── owner actions ──

  setPermission(permission: RemotePermission): void {
    if (this.state === 'ended' || permission === this.permission) return;
    this.permission = permission;
    if (permission === 'view') this.input.release();
    this.send({ t: 'permission', permission });
    this.events.onChange();
  }

  /** +minutes, or 0 = no limit. */
  extend(minutes: SessionMinutes): void {
    if (this.state === 'ended') return;
    this.expiresAt =
      minutes === 0
        ? null
        : Math.max(this.expiresAt ?? Date.now(), Date.now()) + minutes * 60_000;
    this.warned = false;
    this.send({
      t: 'timer',
      expiresInMs: this.expiresAt === null ? null : this.expiresAt - Date.now(),
    });
    this.events.onChange();
  }

  /** Direct or through TURN? Re-applies the encoder caps when that changes. */
  private async checkRoute(): Promise<void> {
    const pc = this.pc;
    if (!pc || pc.connectionState !== 'connected') return;
    try {
      const report = (await pc.getStats()) as Map<
        string,
        Record<string, unknown>
      >;
      let pair: Record<string, unknown> | null = null;
      report.forEach(s => {
        if (
          s.type === 'candidate-pair' &&
          s.state === 'succeeded' &&
          (s.nominated === true || s.selected === true)
        )
          pair = s;
      });
      const selected = pair as Record<string, unknown> | null;
      const relayed =
        !!selected &&
        [selected.localCandidateId, selected.remoteCandidateId].some(
          id => report.get(String(id))?.candidateType === 'relay',
        );
      if (relayed !== this.relayed && this.pc === pc) {
        this.relayed = relayed;
        await this.applyQuality();
      }
    } catch {
      // Stats are best effort.
    }
  }

  /** The control service was switched on/off: tell the viewer. */
  refreshInputStatus(): void {
    this.send({ t: 'input-status', problem: this.inputProblem() });
    this.events.onChange();
  }

  // ── timers, resume ──

  private tick(): void {
    if (this.state === 'ended') return;
    const now = Date.now();
    if (this.state === 'reconnecting') {
      if (now - this.suspendedAt > RESUME_WINDOW_MS)
        this.end('The connection was lost.', false);
      return;
    }
    if (this.expiresAt !== null) {
      const left = this.expiresAt - now;
      if (left <= 0) return this.end('The session time is over.');
      if (!this.warned && left <= EXPIRY_WARNING_MS) {
        this.warned = true;
        this.send({ t: 'warning', remainingMs: left });
      }
    }
    if (now - this.routeCheckedAt >= ROUTE_CHECK_MS) {
      this.routeCheckedAt = now;
      void this.checkRoute();
    }
    if (now - this.lastPingAt >= KEEPALIVE_MS) {
      this.lastPingAt = now;
      this.send({ t: 'ping' });
    }
    if (this.channel && now - this.channel.lastReceivedAt > LINK_TIMEOUT_MS)
      this.channel.close('No answer.');
  }

  private suspend(): void {
    if (this.state !== 'active') return;
    this.state = 'reconnecting';
    this.suspendedAt = Date.now();
    this.channel = null;
    this.closePc();
    this.input.release();
    this.events.onChange();
  }

  /** A resume attempt for this session, proven with the token. */
  canResume(peerId: string, check: (token: Uint8Array) => boolean): boolean {
    return (
      this.state === 'reconnecting' &&
      peerId === this.peer.id &&
      check(this.resumeToken)
    );
  }

  /** Read fresh (tick() may have ended the session). */
  private isEnded(): boolean {
    return this.state === 'ended';
  }

  /**
   * Dropped longer ago than the resume window. Timers may have been paused in
   * the background, so a new connection checks this rather than trusting them.
   */
  isStale(): boolean {
    return (
      this.state === 'reconnecting' &&
      Date.now() - this.suspendedAt > RESUME_WINDOW_MS
    );
  }

  /** Same device connected again (proven by its key) while this session looks alive: replace it. */
  isFromPeer(peerId: string): boolean {
    return this.peer.id === peerId;
  }

  async resumeWith(channel: Channel): Promise<GrantPayload> {
    this.resumeToken = randomToken();
    this.channel = channel;
    return this.grantPayload(() => {
      this.state = 'active';
      this.attach(channel);
      this.events.onChange();
    });
  }

  end(reason: string, notify = true): void {
    if (this.state === 'ended') return;
    this.state = 'ended';
    if (this.ticker) clearInterval(this.ticker);
    this.input.release();
    if (notify) this.channel?.closeAfter({ t: 'end', reason });
    else this.channel?.close('Ended.');
    this.channel = null;
    this.closePc();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream?.release?.();
    this.stream = null;
    this.events.onEnded(this, reason);
  }
}
