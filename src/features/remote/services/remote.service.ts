import { AppState } from 'react-native';
import { DEFAULT_REMOTE_PORT, REMOTE_SERVER } from '../core/constants';
import { legacyDeviceIdFromPublicKey } from '../core/crypto';
import type { Channel } from '../core/channel';
import {
  RemoteError,
  runClientHandshake,
  type Granted,
  type HostInfo,
} from '../core/handshake';
import { parseConnectTarget } from '../core/ids';
import {
  appendHistory,
  clearHistory,
  loadDevices,
  loadHistory,
  saveDevices,
} from '../store/remoteData.store';
import { remoteSettingsStore } from '../store/remoteSettings.store';
import type {
  DiscoveredDevice,
  HistoryEntry,
  QualityPreset,
  SavedDevice,
} from '../types';
import { dial, routesFor, type Route } from './dial';
import { Discovery } from './discovery';
import { HostService, type HostStatus } from './hostService';
import { localFingerprint, localIdentity } from './identity';
import { remoteNative } from './native.service';
import { iceServersFor } from './rtc';
import { SavedPasswords } from './savedPasswords';
import { ViewerSession, type ViewerSnapshot } from './viewerSession';

/*
 * Remote Access, app-wide: this phone's identity, LAN discovery, saved
 * devices, history, the outgoing session (this phone controlling another
 * device) and the host service (another device controlling this phone).
 * Screens read it through hooks (useSyncExternalStore) and call its actions.
 */

export type ConnectStage =
  | 'idle'
  | 'connecting'
  | 'password'
  | 'waiting'
  | 'error';

export interface ConnectState {
  stage: ConnectStage;
  target: string;
  /** Who answered (after the first hello). */
  hostName: string | null;
  verificationCode: string | null;
  /** 0–1 while the password key is being derived. */
  progress: number | null;
  /** i18n key under remote.errors, plus optional detail. */
  errorCode: string | null;
  errorDetail: string | null;
  retryAfterMs: number;
  /** The wrong password was the saved one, and it has been forgotten. */
  savedPasswordRemoved: boolean;
}

export interface ConnectOptions {
  /** Save the typed password after it works (default: the setting). */
  remember?: boolean;
  /** No password given: use this device's saved one, if there is one. */
  useSaved?: boolean;
}

export interface RemoteState {
  identity: { id: string; name: string; fingerprint: string };
  addresses: string[];
  discovered: DiscoveredDevice[];
  saved: SavedDevice[];
  history: HistoryEntry[];
  /** Device IDs with a saved password. */
  savedPasswordIds: string[];
  connect: ConnectState;
  viewer: ViewerSnapshot | null;
  host: HostStatus;
}

const IDLE: ConnectState = {
  stage: 'idle',
  target: '',
  hostName: null,
  verificationCode: null,
  progress: null,
  errorCode: null,
  errorDetail: null,
  retryAfterMs: 0,
  savedPasswordRemoved: false,
};

const effectiveRelay = (): string =>
  remoteSettingsStore.read().relay || REMOTE_SERVER.relay;

class RemoteService {
  private state: RemoteState;
  private listeners = new Set<() => void>();
  private discovery: Discovery;
  private host: HostService;
  private viewer: ViewerSession | null = null;
  private abort: AbortController | null = null;
  private started = false;
  readonly passwords = new SavedPasswords({
    available: remoteNative.canSealSecrets,
    seal: plain => remoteNative.sealSecret(plain),
    open: sealed => remoteNative.openSecret(sealed),
  });

  constructor() {
    this.discovery = new Discovery(
      DEFAULT_REMOTE_PORT + 1,
      () => {
        const identity = localIdentity();
        const settings = remoteSettingsStore.read();
        return {
          id: legacyDeviceIdFromPublicKey(identity.publicKey),
          name: identity.name,
          os: identity.os,
          platform: identity.platform,
          port: DEFAULT_REMOTE_PORT,
          fp: settings.allowIncoming ? localFingerprint() : '',
        };
      },
      () => this.set({ discovered: this.discovery.list() }),
    );
    this.host = new HostService({
      onChange: () => this.set({ host: this.host.snapshot }),
      history: entry => this.history({ ...entry, direction: 'incoming' }),
    });
    this.state = {
      identity: { id: '', name: '', fingerprint: '' },
      addresses: [],
      discovered: [],
      saved: loadDevices(),
      history: loadHistory(),
      savedPasswordIds: this.passwords.ids(),
      connect: IDLE,
      viewer: null,
      host: this.host.snapshot,
    };
  }

  // ── store ──

  getState = (): RemoteState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<RemoteState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(l => l());
  }

  private history(entry: Omit<HistoryEntry, 'at'>): void {
    this.set({ history: appendHistory({ at: Date.now(), ...entry }) });
  }

  // ── lifecycle ──

  /** Called once the app is up (RemoteHostOverlay mounts): identity, discovery, host. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const identity = localIdentity();
    this.set({
      identity: {
        id: identity.id,
        name: identity.name,
        fingerprint: localFingerprint(),
      },
    });
    remoteSettingsStore.subscribe(() => {
      this.applySettings().catch(() => undefined);
    });
    AppState.addEventListener('change', state => {
      if (state === 'active') void this.host.refreshControlService();
    });
    void this.applySettings();
  }

  private async applySettings(): Promise<void> {
    const settings = remoteSettingsStore.read();
    const identity = localIdentity();
    this.set({ identity: { ...this.state.identity, name: identity.name } });
    if (settings.lanDiscovery) {
      this.discovery.start(settings.allowIncoming && remoteNative.canHost);
      this.discovery.setAnnounce(
        settings.allowIncoming && remoteNative.canHost,
      );
    } else if (this.discovery.running) this.discovery.stop();
    await this.host.apply(effectiveRelay());
    const addresses = await remoteNative.networkAddresses().catch(() => []);
    this.set({
      addresses: addresses.map(a => a.address),
      host: this.host.snapshot,
    });
  }

  refreshDevices(): void {
    this.discovery.query();
    void this.host.refreshControlService();
  }

  // ── connecting (this phone → another device) ──

  async connect(
    target: string,
    typedPassword?: string,
    options: ConnectOptions = {},
  ): Promise<boolean> {
    if (
      this.state.connect.stage === 'connecting' ||
      this.state.connect.stage === 'waiting'
    )
      return false;
    if (this.viewer && this.viewer.snapshot.state !== 'ended')
      this.viewer.disconnect();
    const parsed = parseConnectTarget(target);
    if (!parsed) {
      this.set({
        connect: { ...IDLE, stage: 'error', target, errorCode: 'badTarget' },
      });
      return false;
    }
    if (parsed.kind === 'id' && parsed.id === this.state.identity.id) {
      this.set({
        connect: { ...IDLE, stage: 'error', target, errorCode: 'self' },
      });
      return false;
    }
    const settings = remoteSettingsStore.read();
    let password = typedPassword;
    let usedSaved = false;
    if (!password && options.useSaved && parsed.kind === 'id') {
      const stored = await this.passwords.get(parsed.id);
      if (stored) {
        password = stored;
        usedSaved = true;
      }
      this.refreshSavedPasswords();
    }
    const remember = options.remember ?? settings.rememberPasswords;
    const saved =
      parsed.kind === 'id'
        ? this.state.saved.find(d => d.id === parsed.id)
        : undefined;
    const lan =
      parsed.kind === 'id' ? this.discovery.find(parsed.id) : undefined;
    const routes =
      parsed.kind === 'id'
        ? routesFor(
            parsed.id,
            lan ? { address: lan.address, port: lan.port } : null,
            saved?.address
              ? { address: saved.address, port: saved.port }
              : null,
            effectiveRelay(),
          )
        : [
            {
              route: {
                kind: 'direct',
                host: parsed.host,
                port: parsed.port,
              } as Route,
              timeoutMs: 5000,
            },
          ];
    const abort = new AbortController();
    this.abort = abort;
    this.set({
      connect: { ...IDLE, stage: password ? 'password' : 'connecting', target },
    });

    let lastError: unknown = new RemoteError('network', '');
    for (const { route, timeoutMs } of routes) {
      if (abort.signal.aborted) break;
      let stream;
      try {
        stream = await dial(route, timeoutMs);
      } catch (error) {
        lastError = new RemoteError(
          'network',
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      try {
        const result = await runClientHandshake(stream, {
          identity: localIdentity(),
          purpose: 'connect',
          ...(parsed.kind === 'id' ? { expectedId: parsed.id } : {}),
          ...(saved?.fingerprint
            ? { pinnedFingerprint: saved.fingerprint }
            : {}),
          ...(password ? { password } : {}),
          requestPermission: settings.viewOnly ? 'view' : 'control',
          signal: abort.signal,
          onHost: host => {
            this.set({
              connect: { ...this.state.connect, hostName: host.name },
            });
          },
          onPending: ({ verificationCode }) =>
            this.set({
              connect: {
                ...this.state.connect,
                stage: 'waiting',
                verificationCode,
              },
            }),
          onPasswordProgress: progress =>
            this.set({ connect: { ...this.state.connect, progress } }),
        });
        if (!result.granted || abort.signal.aborted) {
          result.channel.close();
          break;
        }
        this.abort = null;
        if (
          parsed.kind === 'id' &&
          password &&
          result.granted.method === 'password' &&
          (usedSaved || remember)
        )
          void this.passwords
            .save(parsed.id, password)
            .then(() => this.refreshSavedPasswords());
        this.startViewer(result.host, result.granted, result.channel, route);
        return true;
      } catch (error) {
        lastError = error;
        // Only a network failure moves on to the next route; an answer from the host is final.
        if (!(error instanceof RemoteError) || error.code !== 'network') break;
      }
    }
    this.abort = null;
    if (abort.signal.aborted) {
      this.set({ connect: IDLE });
      return false;
    }
    const err =
      lastError instanceof RemoteError
        ? lastError
        : new RemoteError('network', String(lastError));
    // A saved password that no longer works is forgotten; the user types the new one.
    const savedPasswordRemoved =
      usedSaved && err.code === 'wrong-password' && parsed.kind === 'id';
    if (savedPasswordRemoved) {
      this.passwords.forget(parsed.id);
      this.refreshSavedPasswords();
    }
    const code =
      err.code !== 'network'
        ? err.code
        : routes.length === 0
        ? 'noRoute'
        : 'unreachable';
    this.set({
      connect: {
        ...this.state.connect,
        stage: 'error',
        errorCode: code,
        errorDetail: err.code === 'network' ? err.message : null,
        retryAfterMs: err.retryAfterMs,
        progress: null,
        savedPasswordRemoved,
      },
    });
    this.history({
      direction: 'outgoing',
      event: 'failed',
      peerId: parsed.kind === 'id' ? parsed.id : '',
      peerName: this.state.connect.hostName ?? target,
      detail: code,
    });
    return false;
  }

  /** Connect again: with the saved password if there is one, else ask the person there. */
  reconnect(id: string): Promise<boolean> {
    return this.connect(id, undefined, { useSaved: true });
  }

  hasSavedPassword(id: string): boolean {
    return this.passwords.has(id);
  }

  forgetSavedPassword(id: string): void {
    this.passwords.forget(id);
    this.refreshSavedPasswords();
  }

  forgetAllSavedPasswords(): void {
    this.passwords.forgetAll();
    this.refreshSavedPasswords();
  }

  private refreshSavedPasswords(): void {
    this.set({ savedPasswordIds: this.passwords.ids() });
  }

  cancelConnect(): void {
    this.abort?.abort();
    this.abort = null;
    this.set({ connect: IDLE });
  }

  clearConnectError(): void {
    if (this.state.connect.stage === 'error') this.set({ connect: IDLE });
  }

  private startViewer(
    host: HostInfo,
    granted: Granted,
    channel: Channel,
    route: Route,
  ): void {
    const settings = remoteSettingsStore.read();
    const session = new ViewerSession(
      host,
      granted,
      channel,
      route,
      iceServersFor(settings),
      settings.defaultQuality,
      settings.priority,
      {
        onChange: () => {
          if (this.viewer === session) this.set({ viewer: session.snapshot });
        },
        onEnded: (_s, reason) => {
          this.history({
            direction: 'outgoing',
            event: 'ended',
            peerId: host.id,
            peerName: host.name,
            detail: reason,
          });
          if (this.viewer === session) this.set({ viewer: session.snapshot });
        },
        onReconnected: () =>
          this.history({
            direction: 'outgoing',
            event: 'reconnected',
            peerId: host.id,
            peerName: host.name,
            detail: '',
          }),
      },
    );
    this.viewer = session;
    this.saveDevice(host, route);
    this.history({
      direction: 'outgoing',
      event: 'connected',
      peerId: host.id,
      peerName: host.name,
      detail: `${granted.method}|${granted.permission}|${route.kind}`,
    });
    this.set({ connect: IDLE, viewer: session.snapshot });
    session.start();
  }

  private saveDevice(host: HostInfo, route: Route): void {
    const existing = this.state.saved.find(d => d.id === host.id);
    const device: SavedDevice = {
      id: host.id,
      name:
        existing?.name && existing.name !== existing.id
          ? existing.name
          : host.name,
      os: host.os,
      platform: host.platform,
      address: route.kind === 'direct' ? route.host : existing?.address ?? '',
      port:
        route.kind === 'direct'
          ? route.port
          : existing?.port ?? DEFAULT_REMOTE_PORT,
      fingerprint: host.fingerprint,
      favorite: existing?.favorite ?? false,
      lastConnectedAt: Date.now(),
    };
    const saved = [device, ...this.state.saved.filter(d => d.id !== host.id)];
    saveDevices(saved);
    this.set({ saved });
  }

  // ── the open session ──

  currentViewer(): ViewerSession | null {
    return this.viewer;
  }

  disconnect(): void {
    this.viewer?.disconnect();
  }

  /** Leave the viewer screen after the session ended. */
  dismissViewer(): void {
    if (this.viewer?.snapshot.state === 'ended') {
      this.viewer = null;
      this.set({ viewer: null });
    }
  }

  /**
   * Change the picture quality and remember it: the next session (after a
   * disconnect, a reconnect or the phone's screen going off) starts with it.
   */
  setQuality(preset: QualityPreset): void {
    this.viewer?.setQuality(preset);
    remoteSettingsStore.update({ defaultQuality: preset });
  }

  // ── saved devices ──

  updateDevice(
    id: string,
    patch: Partial<Pick<SavedDevice, 'name' | 'favorite'>>,
  ): void {
    const saved = this.state.saved.map(d =>
      d.id === id
        ? {
            ...d,
            ...patch,
            name: (patch.name ?? d.name).trim().slice(0, 64) || d.id,
          }
        : d,
    );
    saveDevices(saved);
    this.set({ saved });
  }

  /** Also forgets the pinned key (to trust a reinstalled device). */
  removeDevice(id: string): void {
    const saved = this.state.saved.filter(d => d.id !== id);
    saveDevices(saved);
    // Forgetting a device also forgets its saved password (same as the desktop).
    this.passwords.forget(id);
    this.set({ saved, savedPasswordIds: this.passwords.ids() });
  }

  clearHistory(): void {
    clearHistory();
    this.set({ history: [] });
  }

  // ── host (this phone is controlled) ──

  hostService(): HostService {
    return this.host;
  }
}

export const remoteService = new RemoteService();
