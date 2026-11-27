import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { mediaDevices } from 'react-native-webrtc';
import { liveCameraSettingsStore } from '../store/liveCameraSettings.store';
import type {
  CreatedStream,
  LiveCameraSettings,
  LiveCameraState,
  RemoteStream,
} from '../types';
import { LiveApiError, liveApi } from './api';
import { liveNative } from './native.service';
import { Publisher } from './publisher';

/*
 * Share Live Camera, app-wide (survives leaving the screen while live):
 * camera preview → create stream on the server → publish (WHIP) → keep it
 * up through network changes → stop. Screens read it through
 * useSyncExternalStore and call its actions.
 *
 * Only one stream per phone: start() refuses while one is running.
 */

const STATUS_MS = 5000;
const STATS_MS = 2000;
const MAX_BACKOFF_MS = 15_000;

const INITIAL: LiveCameraState = {
  phase: 'idle',
  previewUrl: null,
  facing: 'back',
  permission: 'unknown',
  cameras: null,
  stream: null,
  startedAt: null,
  stats: null,
  network: null,
  error: null,
  backgroundWarning: false,
  busy: false,
};

const errorCode = (e: unknown): string => {
  if (e instanceof LiveApiError) {
    if (e.code === 'network') return 'server_unreachable';
    if (e.code === 'rate_limited' || e.code === 'too_many_streams')
      return 'rate_limited';
    if (e.code === 'server_full') return 'server_full';
    if (e.code === 'bad_password' || e.code === 'password_required')
      return 'password';
    return 'server_error';
  }
  return 'camera_failed';
};

type Listener = () => void;

class LiveCameraService {
  private state: LiveCameraState = INITIAL;
  private readonly listeners = new Set<Listener>();
  private readonly publisher = new Publisher();
  private created: CreatedStream | null = null;
  private server = '';
  private whipSession: string | null = null;
  /** In memory only, for the current stream. */
  private password = '';
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private generation = 0;
  private screenOpen = false;
  private started = false;

  constructor() {
    this.publisher.onConnected = () => {
      this.backoff = 1000;
      if (this.created)
        this.set({
          phase: 'live',
          error: null,
          startedAt: this.state.startedAt ?? Date.now(),
        });
    };
    this.publisher.onDrop = () => this.reconnect();
  }

  // ── store ──

  get snapshot(): LiveCameraState {
    return this.state;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<LiveCameraState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l());
  }

  /** Native events and app state, wired once. */
  private init(): void {
    if (this.started) return;
    this.started = true;
    liveNative.onEvent(e => {
      if (e.type === 'stop') this.stop();
      else if (e.type === 'network') {
        const was = this.state.network;
        this.set({ network: e.network });
        // A new network (Wi-Fi ↔ mobile data) or coming back online:
        // reconnect now instead of waiting for WebRTC to notice.
        const changed =
          !was ||
          was.transport !== e.network.transport ||
          was.online !== e.network.online;
        if (changed && e.network.online && this.created) this.reconnect(true);
      }
    });
    liveNative.network().then(n => n && this.set({ network: n }));
    AppState.addEventListener('change', s => {
      // Without a stream the camera is released in the background and
      // re-opened on return; while live the foreground service keeps it.
      if (this.created) return;
      if (s === 'background') this.releaseCamera();
      else if (s === 'active' && this.screenOpen) this.openPreview();
    });
  }

  // ── camera ──

  private async ensurePermissions(audio: boolean): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const wanted = [PermissionsAndroid.PERMISSIONS.CAMERA];
    if (audio) wanted.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    const result = await PermissionsAndroid.requestMultiple(wanted);
    const cam = result[PermissionsAndroid.PERMISSIONS.CAMERA];
    if (cam !== PermissionsAndroid.RESULTS.GRANTED) {
      this.set({
        permission:
          cam === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
            ? 'blocked'
            : 'denied',
      });
      return false;
    }
    this.set({ permission: 'granted' });
    if (
      audio &&
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !==
        PermissionsAndroid.RESULTS.GRANTED
    ) {
      this.set({ error: 'mic_denied' });
      return false;
    }
    return true;
  }

  private async detectCameras(): Promise<void> {
    try {
      const devices = (await mediaDevices.enumerateDevices()) as {
        kind: string;
        facing?: string;
      }[];
      const video = devices.filter(d => d.kind === 'videoinput');
      this.set({
        cameras: {
          front: video.some(d => d.facing === 'front'),
          back: video.some(d => d.facing !== 'front'),
        },
      });
    } catch {
      this.set({ cameras: null });
    }
  }

  /** The screen is showing: open the camera for the preview. */
  async openPreview(): Promise<void> {
    this.init();
    this.screenOpen = true;
    if (this.publisher.cameraOpen) return;
    const s = liveCameraSettingsStore.read();
    if (!(await this.ensurePermissions(s.audio))) return;
    await this.detectCameras();
    if (
      this.state.cameras &&
      !this.state.cameras.front &&
      !this.state.cameras.back
    ) {
      this.set({ error: 'no_camera' });
      return;
    }
    const facing =
      this.state.cameras && !this.state.cameras[s.facing]
        ? s.facing === 'front'
          ? 'back'
          : 'front'
        : s.facing;
    try {
      await this.publisher.openCamera({ ...s, facing });
      this.set({
        phase: this.created ? this.state.phase : 'preview',
        previewUrl: this.publisher.previewUrl,
        facing,
        error: this.state.error === 'camera_failed' ? null : this.state.error,
      });
    } catch {
      this.set({ error: 'camera_failed', phase: 'idle', previewUrl: null });
    }
  }

  /** The screen closed: release the camera unless streaming. */
  closePreview(): void {
    this.screenOpen = false;
    if (!this.created && this.state.phase !== 'starting') this.releaseCamera();
  }

  private releaseCamera(): void {
    this.publisher.closeCamera();
    this.set({ phase: 'idle', previewUrl: null, stats: null });
  }

  switchCamera(): void {
    if (!this.publisher.cameraOpen) return;
    this.publisher.switchCamera();
    const facing = this.state.facing === 'front' ? 'back' : 'front';
    liveCameraSettingsStore.update({ facing });
    this.set({ facing });
  }

  /** Resolution / FPS / audio changed (only while not live): re-open the camera. */
  async applyCameraSettings(): Promise<void> {
    if (this.created || !this.screenOpen) return;
    this.publisher.closeCamera();
    this.set({ previewUrl: null });
    await this.openPreview();
  }

  // ── streaming ──

  setPassword(password: string): void {
    this.password = password;
  }

  /** The stream password for this app session (memory only, never saved). */
  get currentPassword(): string {
    return this.password;
  }

  async start(): Promise<void> {
    if (this.created || this.state.phase === 'starting') return;
    const s = liveCameraSettingsStore.read();
    this.server = s.serverUrl;
    if (!this.server) return this.set({ error: 'no_server' });
    if (s.access === 'private' && this.password.length < 4)
      return this.set({ error: 'password' });
    if (!this.publisher.cameraOpen) await this.openPreview();
    if (!this.publisher.cameraOpen) return;
    const gen = ++this.generation;
    this.set({ phase: 'starting', error: null, backgroundWarning: false });

    // The foreground service first (needs the app in front); without it the
    // stream would stop when the app is minimised, so warn but carry on.
    const fg = await liveNative.startService(s.title || 'Live camera', s.audio);
    if (gen !== this.generation) return;
    this.set({ backgroundWarning: !fg && liveNative.available });

    try {
      const created = await liveApi.create(this.server, {
        title: s.title,
        access: s.access,
        password: s.access === 'private' ? this.password : undefined,
        maxViewers: s.maxViewers,
      });
      if (gen !== this.generation) {
        liveApi.end(this.server, created.id, created.ownerToken);
        return;
      }
      this.created = created;
      this.set({ stream: toRemote(created) });
      await this.publish(gen);
      this.startTimers();
    } catch (e) {
      if (gen !== this.generation) return;
      await this.teardown();
      this.set({
        phase: this.publisher.cameraOpen ? 'preview' : 'idle',
        error: errorCode(e),
      });
    }
  }

  private async publish(gen: number): Promise<void> {
    const c = this.created;
    if (!c) return;
    if (this.whipSession) {
      liveApi.unpublish(this.whipSession, c.ownerToken);
      this.whipSession = null;
    }
    await this.publisher.connect(c.iceServers, async offer => {
      const r = await liveApi.publish(
        this.server,
        c.whipUrl,
        c.ownerToken,
        offer,
      );
      if (gen === this.generation) this.whipSession = r.session;
      return r.answer;
    });
  }

  /** Re-publish after a drop / network change, with backoff. The camera stays open. */
  private reconnect(now = false): void {
    if (!this.created) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.set({ phase: 'reconnecting', stats: null });
    const delay = now ? 300 : this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      const gen = this.generation;
      try {
        await this.publish(gen);
      } catch (e) {
        if (gen !== this.generation || !this.created) return;
        if (e instanceof LiveApiError && e.status === 404) {
          // The server no longer knows the stream (restarted / expired).
          await this.teardown();
          this.set({
            phase: this.publisher.cameraOpen ? 'preview' : 'idle',
            error: 'stream_ended',
          });
          return;
        }
        this.reconnect();
      }
    }, delay);
  }

  private startTimers(): void {
    this.stopTimers();
    this.statusTimer = setInterval(() => this.refreshStatus(), STATUS_MS);
    this.statsTimer = setInterval(async () => {
      const stats = await this.publisher.stats().catch(() => null);
      if (stats && this.created) this.set({ stats });
    }, STATS_MS);
  }

  private stopTimers(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.statusTimer = this.statsTimer = this.retryTimer = null;
  }

  private async refreshStatus(): Promise<void> {
    const c = this.created;
    if (!c) return;
    try {
      const stream = await liveApi.get(this.server, c.id, c.ownerToken);
      if (this.created !== c) return;
      this.set({ stream });
      const mins = this.state.startedAt
        ? Math.floor((Date.now() - this.state.startedAt) / 60000)
        : 0;
      liveNative.updateNotification(
        `${this.state.phase === 'live' ? 'Live' : 'Reconnecting'} · ${
          stream.viewers
        } watching · ${mins} min`,
      );
    } catch (e) {
      if (e instanceof LiveApiError && e.status === 404 && this.created === c) {
        await this.teardown();
        this.set({
          phase: this.publisher.cameraOpen ? 'preview' : 'idle',
          error: 'stream_ended',
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.generation++;
    await this.teardown();
    if (!this.screenOpen) this.releaseCamera();
    else this.set({ phase: this.publisher.cameraOpen ? 'preview' : 'idle' });
  }

  /** Ends the stream on the server and here (camera stays open for the preview). */
  private async teardown(): Promise<void> {
    this.stopTimers();
    const c = this.created;
    this.created = null;
    this.publisher.disconnect();
    liveNative.stopService();
    if (c) {
      if (this.whipSession) liveApi.unpublish(this.whipSession, c.ownerToken);
      liveApi.end(this.server, c.id, c.ownerToken);
    }
    this.whipSession = null;
    this.backoff = 1000;
    this.set({
      stream: null,
      startedAt: null,
      stats: null,
      backgroundWarning: false,
    });
  }

  // ── link + live settings ──

  private async owner<T>(
    fn: (c: CreatedStream) => Promise<T>,
  ): Promise<T | null> {
    const c = this.created;
    if (!c) return null;
    this.set({ busy: true });
    try {
      return await fn(c);
    } catch (e) {
      this.set({ error: errorCode(e) });
      return null;
    } finally {
      this.set({ busy: false });
    }
  }

  async regenerateLink(): Promise<void> {
    const s = await this.owner(c =>
      liveApi.regenerate(this.server, c.id, c.ownerToken),
    );
    if (s) this.set({ stream: s });
  }

  async revokeLink(): Promise<void> {
    const s = await this.owner(c =>
      liveApi.revoke(this.server, c.id, c.ownerToken),
    );
    if (s) this.set({ stream: s });
  }

  /** Title / access / password / max viewers changed while live. */
  async pushSettings(s: LiveCameraSettings): Promise<boolean> {
    if (!this.created) return true;
    if (
      s.access === 'private' &&
      !this.state.stream?.hasPassword &&
      this.password.length < 4
    ) {
      this.set({ error: 'password' });
      return false;
    }
    const stream = await this.owner(c =>
      liveApi.update(this.server, c.id, c.ownerToken, {
        title: s.title,
        access: s.access,
        password:
          s.access === 'private' && this.password ? this.password : undefined,
        maxViewers: s.maxViewers,
      }),
    );
    if (stream) this.set({ stream });
    return !!stream;
  }

  clearError(): void {
    this.set({ error: null });
  }

  /** Checks the server is reachable (settings "Test"). */
  async testServer(url: string): Promise<boolean> {
    try {
      return await liveApi.health(url);
    } catch {
      return false;
    }
  }
}

const toRemote = (c: CreatedStream): RemoteStream => ({
  id: c.id,
  publicId: c.publicId,
  viewerUrl: c.viewerUrl,
  live: c.live,
  viewers: c.viewers,
  title: c.title,
  access: c.access,
  maxViewers: c.maxViewers,
  hasPassword: c.hasPassword,
  createdAt: c.createdAt,
  expiresAt: c.expiresAt,
});

export const liveCameraService = new LiveCameraService();
