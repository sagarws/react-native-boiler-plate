import dgram from 'react-native-udp';
import { fromUtf8, utf8 } from '../core/bytes';
import { ANNOUNCE_MS, DISCOVERY_TAG, ONLINE_MS } from '../core/constants';
import { cleanText, parseDeviceId } from '../core/ids';
import type { DiscoveredDevice, RemotePlatform } from '../types';
import { remoteNative } from './native.service';

/*
 * Finding Featured App devices on this Wi-Fi: every few seconds each app
 * broadcasts a small UDP datagram (port = session port + 1) with its device
 * ID, name and session port, and answers queries — the same datagrams as the
 * desktop app. Nothing leaves the local network. An announcement is not
 * trusted for identity; the connection itself proves who is at the address.
 */

export interface Announcement {
  id: string;
  name: string;
  os: string;
  platform: string;
  port: number;
  fp: string;
}

const PLATFORMS: readonly RemotePlatform[] = [
  'darwin',
  'win32',
  'linux',
  'android',
  'ios',
];

export const parseAnnouncement = (
  data: Uint8Array,
):
  | (Omit<Announcement, 'platform'> & {
      platform: RemotePlatform;
      query: boolean;
    })
  | null => {
  if (data.length > 2048) return null;
  try {
    const v = JSON.parse(fromUtf8(data)) as Record<string, unknown>;
    if (v.app !== DISCOVERY_TAG || v.v !== 1) return null;
    if (v.q === 1)
      return {
        id: '',
        name: '',
        os: '',
        platform: 'linux',
        port: 0,
        fp: '',
        query: true,
      };
    const id = typeof v.id === 'string' ? parseDeviceId(v.id) : null;
    const port = v.port;
    if (
      !id ||
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      return null;
    const platform = PLATFORMS.includes(v.platform as RemotePlatform)
      ? (v.platform as RemotePlatform)
      : 'linux';
    return {
      id,
      name: cleanText(v.name, 64) || id,
      os: cleanText(v.os, 64),
      platform,
      port,
      fp: cleanText(v.fp, 64),
      query: false,
    };
  } catch {
    return null;
  }
};

type UdpSocket = ReturnType<typeof dgram.createSocket>;

export class Discovery {
  private socket: UdpSocket | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private devices = new Map<string, DiscoveredDevice>();
  private broadcasts: string[] = ['255.255.255.255'];
  private announcing = false;

  constructor(
    private readonly port: number,
    private readonly self: () => Announcement,
    private readonly onChange: () => void,
  ) {}

  get running(): boolean {
    return this.socket !== null;
  }

  start(announce: boolean): void {
    this.announcing = announce;
    if (this.socket) return;
    remoteNative.setDiscoveryLock(true);
    void this.refreshBroadcasts();
    const socket = dgram.createSocket({ type: 'udp4', reusePort: true });
    this.socket = socket;
    // The library's EventEmitter typings don't reach TS here.
    const events = socket as unknown as {
      on(event: string, cb: (...args: never[]) => void): void;
    };
    events.on('error', () => this.stop());
    events.on('message', (data: Uint8Array, rinfo: { address: string }) =>
      this.onMessage(data, rinfo.address),
    );
    socket.bind(this.port, () => {
      try {
        socket.setBroadcast(true);
      } catch {
        // some networks forbid broadcast; listening still works
      }
      this.send({ app: DISCOVERY_TAG, v: 1, q: 1 });
      this.tick();
    });
    this.timer = setInterval(() => this.tick(), ANNOUNCE_MS);
  }

  setAnnounce(announce: boolean): void {
    this.announcing = announce;
    if (announce) this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
    remoteNative.setDiscoveryLock(false);
    this.devices.clear();
    this.onChange();
  }

  /** Ask everyone to announce now (pull to refresh). */
  query(): void {
    void this.refreshBroadcasts();
    this.send({ app: DISCOVERY_TAG, v: 1, q: 1 });
  }

  list(): DiscoveredDevice[] {
    const now = Date.now();
    return [...this.devices.values()]
      .filter(d => now - d.lastSeen < ONLINE_MS)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  find(id: string): DiscoveredDevice | undefined {
    const d = this.devices.get(id);
    return d && Date.now() - d.lastSeen < ONLINE_MS ? d : undefined;
  }

  private async refreshBroadcasts(): Promise<void> {
    const addresses = await remoteNative.networkAddresses().catch(() => []);
    const set = new Set<string>(['255.255.255.255']);
    for (const a of addresses) if (a.broadcast) set.add(a.broadcast);
    this.broadcasts = [...set];
  }

  private tick(): void {
    if (this.announcing)
      this.send({ app: DISCOVERY_TAG, v: 1, ...this.self() });
    const now = Date.now();
    let changed = false;
    for (const [id, d] of this.devices) {
      if (now - d.lastSeen > ONLINE_MS) {
        if (now - d.lastSeen > ONLINE_MS * 4) this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) this.onChange();
  }

  private send(message: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket) return;
    const data = utf8(JSON.stringify(message));
    for (const address of this.broadcasts) {
      try {
        socket.send(data, 0, data.length, this.port, address, () => undefined);
      } catch {
        // network gone; the next tick tries again
      }
    }
  }

  private onMessage(data: Uint8Array, address: string): void {
    const a = parseAnnouncement(data);
    if (!a) return;
    if (a.query) {
      if (this.announcing)
        this.send({ app: DISCOVERY_TAG, v: 1, ...this.self() });
      return;
    }
    if (a.id === parseDeviceId(this.self().id)) return;
    const previous = this.devices.get(a.id);
    this.devices.set(a.id, {
      id: a.id,
      name: a.name,
      os: a.os,
      platform: a.platform,
      address,
      port: a.port,
      fingerprint: a.fp,
      lastSeen: Date.now(),
    });
    if (
      !previous ||
      previous.name !== a.name ||
      previous.address !== address ||
      Date.now() - previous.lastSeen > ONLINE_MS
    )
      this.onChange();
  }
}
