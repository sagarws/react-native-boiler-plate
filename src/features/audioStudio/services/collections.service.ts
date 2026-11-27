import { pickPicture } from '@/shared/utils/pickFile';
import { collectionsStore } from '../store/stores';
import type { Playlist, Song } from '../types';

/* Liked songs and playlists (local only). */

const newId = () =>
  `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const touch = (p: Playlist, patch: Partial<Playlist>): Playlist => ({
  ...p,
  ...patch,
  updatedAt: Date.now(),
});

const updatePlaylist = (id: string, fn: (p: Playlist) => Playlist) =>
  collectionsStore.update(c => ({
    ...c,
    playlists: c.playlists.map(p => (p.id === id ? fn(p) : p)),
  }));

/** Moves one item of a list (used for queue-like reordering). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item as T);
  return next;
}

export const collectionsService = {
  isLiked: (id: string) => id in collectionsStore.read().liked,

  toggleLike(id: string): boolean {
    let liked = false;
    collectionsStore.update(c => {
      const next = { ...c.liked };
      if (id in next) delete next[id];
      else {
        next[id] = Date.now();
        liked = true;
      }
      return { ...c, liked: next };
    });
    return liked;
  },

  createPlaylist(name: string, songIds: string[] = []): Playlist {
    const now = Date.now();
    const p: Playlist = {
      id: newId(),
      name: name.trim().slice(0, 80) || 'Playlist',
      songIds: [...new Set(songIds)],
      cover: null,
      createdAt: now,
      updatedAt: now,
    };
    collectionsStore.update(c => ({ ...c, playlists: [p, ...c.playlists] }));
    return p;
  },

  renamePlaylist: (id: string, name: string) =>
    updatePlaylist(id, p =>
      touch(p, { name: name.trim().slice(0, 80) || p.name }),
    ),

  deletePlaylist: (id: string) =>
    collectionsStore.update(c => ({
      ...c,
      playlists: c.playlists.filter(p => p.id !== id),
    })),

  addSongs: (id: string, songs: Song[]) =>
    updatePlaylist(id, p =>
      touch(p, {
        songIds: [
          ...p.songIds,
          ...songs.map(s => s.id).filter(s => !p.songIds.includes(s)),
        ],
      }),
    ),

  removeSong: (id: string, index: number) =>
    updatePlaylist(id, p =>
      touch(p, { songIds: p.songIds.filter((_, i) => i !== index) }),
    ),

  moveSong: (id: string, from: number, to: number) =>
    updatePlaylist(id, p =>
      touch(p, { songIds: moveItem(p.songIds, from, to) }),
    ),

  async changeCover(id: string): Promise<void> {
    const uri = await pickPicture();
    if (uri) updatePlaylist(id, p => touch(p, { cover: uri }));
  },

  removeCover: (id: string) =>
    updatePlaylist(id, p => touch(p, { cover: null })),
};
