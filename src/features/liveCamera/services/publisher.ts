import {
  mediaDevices,
  RTCPeerConnection,
  type MediaStream,
} from 'react-native-webrtc';
import type {
  ConnectionQuality,
  Facing,
  FrameRate,
  IceServer,
  PublishStats,
  Resolution,
} from '../types';

/*
 * One camera, one outgoing WebRTC connection (WHIP to the server, which fans
 * out to every viewer, so the phone uploads once however many watch).
 *
 * The camera and the connection have separate lifetimes: a network change
 * or a dropped connection replaces only the RTCPeerConnection, the camera
 * keeps running, so a reconnect costs a second or two and never re-opens it.
 */

export const DIMENSIONS: Record<Resolution, { width: number; height: number }> =
  {
    '480p': { width: 854, height: 480 },
    '720p': { width: 1280, height: 720 },
    '1080p': { width: 1920, height: 1080 },
  };

/** Upload ceiling at 30 FPS; WebRTC's congestion control adapts below it. */
const MAX_KBPS: Record<Resolution, number> = {
  '480p': 1000,
  '720p': 2000,
  '1080p': 3800,
};

export const maxBitrate = (resolution: Resolution, fps: FrameRate): number =>
  Math.round(MAX_KBPS[resolution] * Math.max(0.6, fps / 30)) * 1000;

/**
 * Connection quality from the network's point of view: round-trip time and
 * whether WebRTC is cutting quality for bandwidth. The frame rate only counts
 * when bandwidth is the limit — in a dark room the camera itself slows down
 * (long exposures), which says nothing about the connection.
 */
export const qualityOf = (
  fps: number,
  targetFps: number,
  rttMs: number | null,
  bandwidthLimited: boolean,
): ConnectionQuality => {
  if (rttMs === null && fps === 0) return 'unknown';
  const rtt = rttMs ?? 0;
  if (rtt >= 600) return 'poor';
  if (bandwidthLimited) return fps >= targetFps * 0.5 ? 'fair' : 'poor';
  return rtt < 250 ? 'good' : 'fair';
};

export interface CameraOptions {
  facing: Facing;
  resolution: Resolution;
  fps: FrameRate;
  audio: boolean;
}

export type SendSdp = (offer: string) => Promise<string>;

export class Publisher {
  private stream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private options: CameraOptions | null = null;
  private lastBytes = 0;
  private lastAt = 0;

  /** Called when the connection is lost (failed, or disconnected too long). */
  onDrop: (() => void) | null = null;
  /** Called once the connection to the server is up. */
  onConnected: (() => void) | null = null;

  get previewUrl(): string | null {
    return this.stream ? this.stream.toURL() : null;
  }

  get cameraOpen(): boolean {
    return !!this.stream;
  }

  /** Opens the camera (and microphone when asked). Re-opens on a setting change. */
  async openCamera(options: CameraOptions): Promise<void> {
    if (this.stream && this.options && sameCamera(this.options, options)) {
      if (this.options.facing !== options.facing) this.switchCamera();
      this.options = options;
      return;
    }
    this.closeCamera();
    const { width, height } = DIMENSIONS[options.resolution];
    this.stream = await mediaDevices.getUserMedia({
      video: {
        facingMode: options.facing === 'front' ? 'user' : 'environment',
        width,
        height,
        frameRate: options.fps,
      },
      audio: options.audio,
    });
    this.options = options;
  }

  switchCamera(): void {
    const track = this.stream?.getVideoTracks()[0];
    // react-native-webrtc's in-place switch: no new camera instance.
    track?._switchCamera();
    if (this.options) {
      this.options = {
        ...this.options,
        facing: this.options.facing === 'front' ? 'back' : 'front',
      };
    }
  }

  closeCamera(): void {
    this.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream?.release();
    this.stream = null;
    this.options = null;
  }

  /**
   * Publishes the open camera: offer → `send` (WHIP) → answer. Resolves once
   * the answer is applied; onConnected fires when media flows.
   */
  async connect(iceServers: IceServer[], send: SendSdp): Promise<void> {
    if (!this.stream || !this.options) throw new Error('camera_closed');
    this.disconnect();
    const pc = new RTCPeerConnection({
      iceServers: iceServers.map(s => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      })),
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;
    for (const track of this.stream.getTracks()) {
      pc.addTransceiver(track, {
        direction: 'sendonly',
        streams: [this.stream],
      });
    }

    let dropTimer: ReturnType<typeof setTimeout> | null = null;
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      const state = pc.connectionState;
      if (dropTimer) clearTimeout(dropTimer);
      dropTimer = null;
      if (state === 'connected') this.onConnected?.();
      else if (state === 'failed') this.onDrop?.();
      else if (state === 'disconnected') {
        // Often a blip that recovers; give it a few seconds.
        dropTimer = setTimeout(() => {
          if (this.pc === pc && pc.connectionState !== 'connected')
            this.onDrop?.();
        }, 5000);
      }
    });

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    await gathered(pc);
    if (this.pc !== pc) throw new Error('cancelled');
    const answer = await send(pc.localDescription?.sdp ?? offer.sdp ?? '');
    if (this.pc !== pc) throw new Error('cancelled');
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });
    await this.applyBitrate(pc);
    this.lastBytes = 0;
    this.lastAt = 0;
  }

  disconnect(): void {
    const pc = this.pc;
    this.pc = null;
    pc?.close();
  }

  private async applyBitrate(pc: RTCPeerConnection): Promise<void> {
    if (!this.options) return;
    const sender = pc
      .getSenders()
      .find(s => s.track && s.track.kind === 'video');
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings.length) return;
      params.encodings[0]!.maxBitrate = maxBitrate(
        this.options.resolution,
        this.options.fps,
      );
      params.encodings[0]!.maxFramerate = this.options.fps;
      await sender.setParameters(params);
    } catch {
      /* the default ceiling still works */
    }
  }

  /** Upload stats since the previous call (call every ~2 s). */
  async stats(): Promise<PublishStats | null> {
    const pc = this.pc;
    if (!pc || !this.options) return null;
    const report = (await pc.getStats()) as Map<
      string,
      Record<string, unknown>
    >;
    let bytes = 0;
    let width = 0;
    let height = 0;
    let fps = 0;
    let rtt: number | null = null;
    let limited = false;
    report.forEach(r => {
      if (r.type === 'outbound-rtp') {
        bytes += Number(r.bytesSent ?? 0);
        if (r.kind === 'video' || r.mediaType === 'video') {
          width = Number(r.frameWidth ?? 0);
          height = Number(r.frameHeight ?? 0);
          fps = Number(r.framesPerSecond ?? 0);
          limited = r.qualityLimitationReason === 'bandwidth';
        }
      } else if (
        r.type === 'candidate-pair' &&
        r.state === 'succeeded' &&
        r.nominated &&
        typeof r.currentRoundTripTime === 'number'
      ) {
        rtt = Math.round(r.currentRoundTripTime * 1000);
      }
    });
    const now = Date.now();
    const kbps =
      this.lastAt && bytes >= this.lastBytes
        ? Math.round(((bytes - this.lastBytes) * 8) / (now - this.lastAt))
        : 0;
    this.lastBytes = bytes;
    this.lastAt = now;
    return {
      width,
      height,
      fps: Math.round(fps),
      kbps,
      rttMs: rtt,
      quality: qualityOf(fps, this.options.fps, rtt, limited),
    };
  }
}

const sameCamera = (a: CameraOptions, b: CameraOptions) =>
  a.resolution === b.resolution && a.fps === b.fps && a.audio === b.audio;

/** Waits for ICE gathering (one offer with every candidate; no trickle needed). */
const gathered = (pc: RTCPeerConnection): Promise<void> =>
  new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(resolve, 2500);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
