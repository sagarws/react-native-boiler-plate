import { AppState } from 'react-native';
import { DEFAULT_REMOTE_PORT } from '../core/constants';
import { MOBILE_HOST_KDF, passwordVerifier, randomToken } from '../core/crypto';
import {
  runHostHandshake,
  type Approval,
  type ApprovalRequest,
  type HostPolicy,
  type UnattendedSecret,
} from '../core/handshake';
import { RelayHost, type RelayState } from '../core/relay';
import type { ByteStream } from '../core/stream';
import {
  loadPeers,
  loadUnattended,
  savePeers,
  saveUnattended,
  type PeerLists,
} from '../store/remoteData.store';
import { remoteSettingsStore } from '../store/remoteSettings.store';
import type {
  HistoryEntry,
  KnownPeer,
  RemotePermission,
  SessionMinutes,
} from '../types';
import { relayOpener } from './dial';
import { HostSession, type HostSessionSnapshot } from './hostSession';
import { localIdentity } from './identity';
import { remoteNative } from './native.service';
import { iceServersFor } from './rtc';
import { listenTcp } from './tcp';

/*
 * This phone as a host: listens on the LAN (TCP 47800), stays registered on
 * the relay, runs the host side of the handshake, asks the person holding the
 * phone (Allow / Decline, with the 6-digit verification code), enforces
 * lockouts, blocked devices and one session at a time.
 *
 * Android only, and only while the app is running.
 */

export interface IncomingRequest {
  requestId: string;
  peerId: string;
  peerName: string;
  peerOs: string;
  address: string;
  verificationCode: string;
  firstTime: boolean;
  requestedPermission: RemotePermission;
  expiresAt: number;
}

export interface HostStatus {
  listening: boolean;
  port: number;
  error: string | null;
  relay: RelayState;
  relayError: string | null;
  controlService: boolean;
  request: IncomingRequest | null;
  session: HostSessionSnapshot | null;
  peers: PeerLists;
  unattendedSet: boolean;
}

export interface HostEvents {
  onChange: () => void;
  history: (entry: Omit<HistoryEntry, 'at' | 'direction'>) => void;
}

/** 3 free failures per key, then 30 s doubling to 15 min. */
class Limiter {
  private entries = new Map<string, { failures: number; until: number }>();
  retryAfter(keys: string[]): number {
    const now = Date.now();
    return Math.max(
      0,
      ...keys.map(k => (this.entries.get(k)?.until ?? 0) - now),
    );
  }
  failure(keys: string[]): void {
    for (const key of keys) {
      const e = this.entries.get(key) ?? { failures: 0, until: 0 };
      e.failures++;
      if (e.failures > 3)
        e.until =
          Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (e.failures - 4));
      this.entries.set(key, e);
    }
  }
  success(keys: string[]): void {
    for (const key of keys) this.entries.delete(key);
  }
}

export class HostService {
  private server: { close: () => void } | null = null;
  private relayHost: RelayHost | null = null;
  private relayAddress = '';
  private session: HostSession | null = null;
  private pending: {
    request: IncomingRequest;
    resolve: (a: Approval | null) => void;
  } | null = null;
  private readonly limiter = new Limiter();
  private peers: PeerLists = loadPeers();
  private status: HostStatus;
  private controlService = false;

  constructor(private readonly events: HostEvents) {
    this.status = {
      listening: false,
      port: DEFAULT_REMOTE_PORT,
      error: null,
      relay: 'off',
      relayError: null,
      controlService: false,
      request: null,
      session: null,
      peers: this.peers,
      unattendedSet: loadUnattended() !== null,
    };
  }

  get snapshot(): HostStatus {
    return this.status;
  }

  private changed(): void {
    this.status = {
      ...this.status,
      controlService: this.controlService,
      request: this.pending?.request ?? null,
      session: this.session?.snapshot() ?? null,
      peers: this.peers,
    };
    this.events.onChange();
  }

  /** Start or stop listening to match the settings. */
  async apply(relay: string): Promise<void> {
    const settings = remoteSettingsStore.read();
    const want = settings.allowIncoming && remoteNative.canHost;
    if (want && !this.server) {
      try {
        this.server = await listenTcp(DEFAULT_REMOTE_PORT, stream => {
          this.incoming(stream).catch(() => undefined);
        });
        this.status = { ...this.status, listening: true, error: null };
      } catch (error) {
        this.status = {
          ...this.status,
          listening: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else if (!want && this.server) {
      this.server.close();
      this.server = null;
      this.status = { ...this.status, listening: false };
      this.session?.end('Remote access was turned off on the phone.');
      this.pending?.resolve(null);
    }
    const relayWanted = want && relay ? relay : '';
    if (relayWanted !== this.relayAddress) {
      this.relayHost?.stop();
      this.relayHost = null;
      this.relayAddress = relayWanted;
      if (relayWanted) {
        this.relayHost = new RelayHost(
          relayOpener(relayWanted),
          localIdentity,
          {
            onState: (state, error) => {
              this.status = { ...this.status, relay: state, relayError: error };
              this.changed();
            },
            onIncoming: stream => {
              this.incoming(stream).catch(() => undefined);
            },
          },
        );
        this.relayHost.start();
      } else this.status = { ...this.status, relay: 'off', relayError: null };
    }
    await this.refreshControlService();
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.relayHost?.stop();
    this.relayHost = null;
    this.relayAddress = '';
    this.session?.end('Remote access was turned off on the phone.');
  }

  async refreshControlService(): Promise<void> {
    const enabled = await remoteNative
      .controlServiceEnabled()
      .catch(() => false);
    if (enabled !== this.controlService) {
      this.controlService = enabled;
      this.session?.refreshInputStatus();
    }
    this.changed();
  }

  // ── handshake policy ──

  private incoming(stream: ByteStream): Promise<void> {
    if (this.session?.isStale())
      this.session.end('The connection was lost.', false);
    return runHostHandshake(stream, this.policy);
  }

  private readonly policy: HostPolicy = {
    identity: localIdentity,
    attended: () => remoteSettingsStore.read().allowIncoming,
    unattended: (): UnattendedSecret | null => {
      const settings = remoteSettingsStore.read();
      const stored = settings.unattendedEnabled ? loadUnattended() : null;
      return stored
        ? {
            ...stored,
            permission: settings.unattendedPermission,
            minutes: settings.defaultMinutes as SessionMinutes,
          }
        : null;
    },
    // A live session from the same device does not count: its new connection replaces the stale one.
    busy: peerId =>
      this.pending !== null ||
      (this.session !== null &&
        this.session.state !== 'ended' &&
        !(peerId && this.session.isFromPeer(peerId))),
    isBlocked: peerId => this.peers.blocked.some(p => p.id === peerId),
    retryAfter: keys => this.limiter.retryAfter(keys),
    failure: keys => this.limiter.failure(keys),
    success: keys => this.limiter.success(keys),
    approve: (request, signal) => this.ask(request, signal),
    grant: ({ channel, peer, method, permission, minutes }) => {
      this.session?.end(
        'Replaced by a new connection from the same device.',
        false,
      );
      const session = new HostSession(
        peer,
        method,
        permission,
        minutes,
        channel,
        {
          onChange: () => this.changed(),
          onEnded: (ended, reason) => {
            if (this.session === ended) this.session = null;
            this.events.history({
              event: 'ended',
              peerId: peer.id,
              peerName: peer.name,
              detail: reason,
            });
            this.changed();
          },
          controlServiceEnabled: () => this.controlService,
          iceServers: () => iceServersFor(remoteSettingsStore.read()),
        },
      );
      this.session = session;
      this.remember(peer.id, peer.name, peer.fingerprint);
      this.events.history({
        event: 'connected',
        peerId: peer.id,
        peerName: peer.name,
        detail: `${method}|${permission}|${minutes}`,
      });
      return session.grantPayload(() => session.begin());
    },
    resume: (sessionId, peer, check, channel) => {
      const session = this.session;
      if (
        !session ||
        session.id !== sessionId ||
        !session.canResume(peer.id, check)
      )
        return 'no-session';
      this.events.history({
        event: 'reconnected',
        peerId: peer.id,
        peerName: peer.name,
        detail: '',
      });
      return session.resumeWith(channel);
    },
    audit: (event, peer, detail) => {
      if (event === 'request') return;
      this.events.history({
        event:
          event === 'blocked'
            ? 'blocked'
            : event === 'auth-failed'
            ? 'auth-failed'
            : event === 'rejected'
            ? 'rejected'
            : 'failed',
        peerId: peer.id,
        peerName: peer.name,
        detail,
      });
    },
  };

  private remember(id: string, name: string, fingerprint: string): void {
    const now = Date.now();
    const existing = this.peers.trusted.find(p => p.id === id);
    const entry: KnownPeer = existing
      ? { ...existing, name, fingerprint, lastSeen: now }
      : { id, name, fingerprint, firstSeen: now, lastSeen: now };
    this.peers = {
      ...this.peers,
      trusted: [entry, ...this.peers.trusted.filter(p => p.id !== id)],
    };
    savePeers(this.peers);
  }

  private ask(
    request: ApprovalRequest,
    signal: AbortSignal,
  ): Promise<Approval | null> {
    return new Promise(resolve => {
      const incoming: IncomingRequest = {
        requestId: Math.random().toString(36).slice(2),
        peerId: request.peer.id,
        peerName: request.peer.name,
        peerOs: request.peer.os,
        address: request.peer.address,
        verificationCode: request.verificationCode,
        firstTime: !this.peers.trusted.some(p => p.id === request.peer.id),
        requestedPermission: request.requestedPermission,
        expiresAt: Date.now() + request.expiresInMs,
      };
      const finish = (answer: Approval | null) => {
        if (this.pending?.request.requestId !== incoming.requestId) return;
        this.pending = null;
        remoteNative.cancelIncoming();
        this.changed();
        resolve(answer);
      };
      this.pending = { request: incoming, resolve: finish };
      signal.addEventListener('abort', () => finish(null));
      if (AppState.currentState !== 'active') {
        remoteNative.notifyIncoming(
          request.peer.name,
          `${request.peer.id} · ${request.verificationCode}`,
        );
      }
      this.changed();
    });
  }

  // ── owner actions (UI) ──

  answer(requestId: string, approval: Approval | null): void {
    if (this.pending?.request.requestId === requestId)
      this.pending.resolve(approval);
  }

  stopSession(): void {
    this.session?.end('The phone’s owner ended the session.');
  }

  setSessionPermission(permission: RemotePermission): void {
    this.session?.setPermission(permission);
  }

  extendSession(minutes: SessionMinutes): void {
    this.session?.extend(minutes);
  }

  block(id: string): void {
    const peer = this.peers.trusted.find(p => p.id === id) ?? {
      id,
      name: id,
      fingerprint: '',
      firstSeen: Date.now(),
      lastSeen: Date.now(),
    };
    this.peers = {
      trusted: this.peers.trusted.filter(p => p.id !== id),
      blocked: [peer, ...this.peers.blocked.filter(p => p.id !== id)],
    };
    savePeers(this.peers);
    if (this.session?.peer.id === id)
      this.session.end('This device was blocked.');
    this.changed();
  }

  unblock(id: string): void {
    this.peers = {
      ...this.peers,
      blocked: this.peers.blocked.filter(p => p.id !== id),
    };
    savePeers(this.peers);
    this.changed();
  }

  forget(id: string): void {
    this.peers = {
      ...this.peers,
      trusted: this.peers.trusted.filter(p => p.id !== id),
    };
    savePeers(this.peers);
    this.changed();
  }

  /** Argon2id once here (a few seconds on a phone); only the verifier is kept. */
  async setPassword(
    password: string | null,
    onProgress?: (f: number) => void,
  ): Promise<void> {
    if (password === null) {
      saveUnattended(null);
      remoteSettingsStore.update({ unattendedEnabled: false });
    } else {
      const salt = randomToken(16);
      const verifier = await passwordVerifier(
        password,
        salt,
        MOBILE_HOST_KDF,
        onProgress,
      );
      saveUnattended({ salt, params: MOBILE_HOST_KDF, verifier });
      remoteSettingsStore.update({ unattendedEnabled: true });
    }
    this.status = { ...this.status, unattendedSet: password !== null };
    this.changed();
  }
}
