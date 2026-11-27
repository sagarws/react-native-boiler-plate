import { P, toParamArray } from '../dsp/params';
import {
  BUILT_IN_EQ,
  BUILT_IN_PRESETS,
  DEFAULT_SETTINGS,
} from '../dsp/presets';
import { moveItem } from '../services/collections.service';
import {
  formatDuration,
  groupSongs,
  searchSongs,
  sortSongs,
} from '../services/library.service';
import { studioService } from '../services/studio.service';
import { cleanSettings, collectionsStore, studioStore } from '../store/stores';
import { collectionsService } from '../services/collections.service';
import type { Song } from '../types';

const song = (id: string, patch: Partial<Song> = {}): Song => ({
  id,
  uri: `content://media/${id}`,
  title: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  albumId: '1',
  genre: '',
  durationMs: 180000,
  folder: 'Music/',
  dateAdded: 0,
  mimeType: 'audio/mpeg',
  size: 1,
  artUri: null,
  source: 'library',
  ...patch,
});

describe('DSP parameters', () => {
  it('produces the engine array in SpatialParams.kt order', () => {
    const p = toParamArray(DEFAULT_SETTINGS);
    expect(p).toHaveLength(P.COUNT);
    expect(p[P.ENABLED]).toBe(1);
    expect(p[P.PATTERN]).toBe(1); // clockwise
    expect(p[P.SOURCE_MODE]).toBe(1); // stereoPair
    expect(p[P.LIMITER]).toBe(1);
    expect(p.slice(P.SPEAKER_0, P.SPEAKER_0 + 8)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it('clamps out-of-range values to what the engine accepts', () => {
    const p = toParamArray({
      ...DEFAULT_SETTINGS,
      azimuth: 999,
      rpm: 500,
      eq: [50, -50, 0, 0, 0, 0, 0, 0, 0, 0],
      output: 40,
      reverbDecay: 0,
    });
    expect(p[P.AZIMUTH]).toBe(180);
    expect(p[P.RPM]).toBe(60);
    expect(p[P.EQ_0]).toBe(12);
    expect(p[P.EQ_0 + 1]).toBe(-12);
    expect(p[P.OUTPUT]).toBe(6);
    expect(p[P.REVERB_DECAY]).toBe(0.2);
  });

  it('every built-in preset changes real parameters and stays valid', () => {
    const base = toParamArray(DEFAULT_SETTINGS);
    for (const preset of BUILT_IN_PRESETS) {
      const p = toParamArray({ ...DEFAULT_SETTINGS, ...preset.settings });
      expect(p.every(Number.isFinite)).toBe(true);
      if (preset.id !== 'customStudio') expect(p).not.toEqual(base);
    }
    expect(BUILT_IN_PRESETS).toHaveLength(15);
  });

  it('EQ presets cut the preamp by at least their largest boost minus headroom', () => {
    for (const e of BUILT_IN_EQ) {
      const maxBoost = Math.max(0, ...e.eq);
      expect(e.preamp).toBeLessThanOrEqual(-(maxBoost - 1) || 0);
    }
  });
});

describe('studio service', () => {
  beforeEach(() => studioStore.resetCacheForTest());

  it('applies, saves, renames and deletes presets', () => {
    studioService.applyPreset('concertHall');
    expect(studioStore.read().settings.room).toBe('concertHall');
    studioService.update({ rpm: 33 });
    expect(studioStore.read().presetId).toBeNull();
    const id = studioService.saveAsPreset('Mine');
    expect(studioService.presets().find(p => p.id === id)?.settings.rpm).toBe(
      33,
    );
    studioService.renamePreset(id, 'Renamed');
    expect(studioService.presets().find(p => p.id === id)?.name).toBe(
      'Renamed',
    );
    studioService.deletePreset(id);
    expect(studioService.presets().some(p => p.id === id)).toBe(false);
  });

  it('edits a built-in and restores it', () => {
    studioService.applyPreset('ultra8d');
    studioService.update({ rpm: 50 }, true);
    studioService.updatePreset('ultra8d');
    expect(
      studioService.presets().find(p => p.id === 'ultra8d')?.settings.rpm,
    ).toBe(50);
    studioService.restoreDefaults();
    expect(
      studioService.presets().find(p => p.id === 'ultra8d')?.settings.rpm,
    ).toBe(10);
  });

  it('saves a custom EQ profile', () => {
    studioService.setEqBand(3, 4.5);
    studioService.saveEqProfile('Car');
    const mine = studioService.eqProfiles().find(p => p.name === 'Car');
    expect(mine?.eq[3]).toBe(4.5);
  });

  it('repairs stored settings', () => {
    const s = cleanSettings({ rpm: 'fast', eq: [1, 2], azimuth: 45 });
    expect(s.rpm).toBe(DEFAULT_SETTINGS.rpm);
    expect(s.eq).toEqual(DEFAULT_SETTINGS.eq);
    expect(s.azimuth).toBe(45);
  });
});

describe('library views', () => {
  const songs = [
    song('1', {
      title: 'beta',
      artist: 'Zed',
      album: 'Two',
      albumId: '2',
      dateAdded: 5,
      genre: 'Pop',
    }),
    song('2', {
      title: 'Alpha',
      artist: 'amy',
      album: 'One',
      dateAdded: 9,
      genre: 'rock',
    }),
    song('3', {
      title: 'gamma',
      artist: 'Amy',
      album: 'One',
      dateAdded: 1,
      genre: '',
    }),
  ];

  it('sorts', () => {
    expect(sortSongs(songs, 'title').map(s => s.id)).toEqual(['2', '1', '3']);
    expect(sortSongs(songs, 'dateAdded').map(s => s.id)).toEqual([
      '2',
      '1',
      '3',
    ]);
  });

  it('searches every word across fields', () => {
    expect(searchSongs(songs, 'amy gam').map(s => s.id)).toEqual(['3']);
    expect(searchSongs(songs, '')).toHaveLength(3);
  });

  it('groups albums, artists (case-insensitive) and unknown genres', () => {
    expect(groupSongs(songs, 'album', '?').map(g => g.title)).toEqual([
      'One',
      'Two',
    ]);
    const artists = groupSongs(songs, 'artist', '?');
    expect(artists).toHaveLength(2);
    expect(groupSongs(songs, 'genre', 'Unknown').map(g => g.title)).toContain(
      'Unknown',
    );
  });

  it('formats durations', () => {
    expect(formatDuration(65000)).toBe('1:05');
    expect(formatDuration(3725000)).toBe('1:02:05');
  });
});

describe('likes and playlists', () => {
  beforeEach(() => collectionsStore.resetCacheForTest());

  it('likes and unlikes', () => {
    expect(collectionsService.toggleLike('a')).toBe(true);
    expect(collectionsService.isLiked('a')).toBe(true);
    expect(collectionsService.toggleLike('a')).toBe(false);
  });

  it('manages a playlist', () => {
    const p = collectionsService.createPlaylist('Road', ['1']);
    collectionsService.addSongs(p.id, [song('2'), song('1'), song('3')]);
    let saved = collectionsStore.read().playlists[0]!;
    expect(saved.songIds).toEqual(['1', '2', '3']);
    collectionsService.moveSong(p.id, 2, 0);
    collectionsService.removeSong(p.id, 1);
    collectionsService.renamePlaylist(p.id, 'Trip');
    saved = collectionsStore.read().playlists[0]!;
    expect(saved.songIds).toEqual(['3', '2']);
    expect(saved.name).toBe('Trip');
    collectionsService.deletePlaylist(p.id);
    expect(collectionsStore.read().playlists).toHaveLength(0);
  });

  it('moves list items', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a'], 5, 0)).toEqual(['a']);
  });
});
