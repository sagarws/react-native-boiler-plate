import { timingSafeEqual } from 'node:crypto';
import { randomId, sha256 } from './crypto.ts';

/*
 * Live streams, in memory (one server; a restart ends every stream and the
 * phone starts a new one). Three identifiers per stream, each for one job:
 *
 *   id        the owner's handle (API paths); useless without ownerToken
 *   publicId  the viewer link /s/<publicId>; regenerating or revoking it kills
 *             the old link and every viewer token issued for it
 *   path      the MediaMTX path; never leaves the server
 */

export type Access = 'public' | 'private';

export interface StreamSettings {
  title: string;
  access: Access;
  maxViewers: number;
}

export interface Stream extends StreamSettings {
  id: string;
  /** null = link revoked (no one can watch until it is regenerated). */
  publicId: string | null;
  path: string;
  ownerTokenHash: Buffer;
  /** scrypt hash; set when access is private. */
  passwordHash: string | null;
  creatorIp: string;
  createdAt: number;
  /** Last time the stream was seen live (or created). */
  lastLiveAt: number;
  /** Publisher byte counter and when it last grew: a phone that vanished
   *  without hanging up stops growing long before WebRTC times it out. */
  lastBytes: number;
  lastBytesAt: number;
}

export const TITLE_MAX = 80;
export const PASSWORD_MAX = 128;

export const cleanTitle = (v: unknown): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, TITLE_MAX)
    : '';

export class StreamStore {
  private readonly byId = new Map<string, Stream>();
  private readonly byPublicId = new Map<string, Stream>();

  get size(): number {
    return this.byId.size;
  }

  all(): Stream[] {
    return [...this.byId.values()];
  }

  countByIp(ip: string): number {
    let n = 0;
    for (const s of this.byId.values()) if (s.creatorIp === ip) n += 1;
    return n;
  }

  create(settings: StreamSettings, passwordHash: string | null, creatorIp: string, now = Date.now()) {
    const ownerToken = randomId(32);
    const stream: Stream = {
      ...settings,
      id: randomId(12),
      publicId: randomId(9),
      path: `s_${randomId(18)}`,
      ownerTokenHash: sha256(ownerToken),
      passwordHash,
      creatorIp,
      createdAt: now,
      lastLiveAt: now,
      lastBytes: 0,
      lastBytesAt: 0,
    };
    this.byId.set(stream.id, stream);
    this.byPublicId.set(stream.publicId!, stream);
    return { stream, ownerToken };
  }

  /** The stream when `ownerToken` is its owner's, else null (same answer for "no such stream"). */
  owned(id: string, ownerToken: string | null): Stream | null {
    const s = this.byId.get(id);
    if (!s || !ownerToken) return null;
    return timingSafeEqual(sha256(ownerToken), s.ownerTokenHash) ? s : null;
  }

  byPublic(publicId: string): Stream | null {
    return this.byPublicId.get(publicId) ?? null;
  }

  byPath(path: string): Stream | null {
    for (const s of this.byId.values()) if (s.path === path) return s;
    return null;
  }

  /** New viewer link; the old one stops working. */
  regenerate(s: Stream): string {
    if (s.publicId) this.byPublicId.delete(s.publicId);
    s.publicId = randomId(9);
    this.byPublicId.set(s.publicId, s);
    return s.publicId;
  }

  revoke(s: Stream): void {
    if (s.publicId) this.byPublicId.delete(s.publicId);
    s.publicId = null;
  }

  remove(s: Stream): void {
    this.byId.delete(s.id);
    if (s.publicId) this.byPublicId.delete(s.publicId);
  }
}
