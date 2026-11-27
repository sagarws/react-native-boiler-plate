/** A playable audio file (MediaStore or imported with the document picker). */
export interface Song {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  genre: string;
  durationMs: number;
  folder: string;
  /** When the file was added to the phone, epoch ms. */
  dateAdded: number;
  mimeType: string;
  size: number;
  artUri: string | null;
  source: 'library' | 'import';
}

export type RepeatMode = 'off' | 'one' | 'all';

export interface PlayerState {
  /** Song ids in the order they will play (shuffle order when shuffled). */
  queue: string[];
  index: number;
  playing: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  repeat: RepeatMode;
  shuffle: boolean;
  speed: number;
  sleepAt: number | null;
  sleepEndOfTrack: boolean;
  error: string | null;
  /** When positionMs was reported (for smooth progress between events). */
  at: number;
}

export interface Playlist {
  id: string;
  name: string;
  songIds: string[];
  /** Image URI (content:// or file://) or null for the generated cover. */
  cover: string | null;
  createdAt: number;
  updatedAt: number;
}

export type MovementPattern =
  | 'static'
  | 'clockwise'
  | 'anticlockwise'
  | 'leftRight'
  | 'rightLeft'
  | 'frontBack'
  | 'backFront'
  | 'random'
  | 'wave'
  | 'figure8';

export type SourceMode = 'single' | 'stereoPair' | 'vocalBed';

export type RoomPreset =
  | 'smallRoom'
  | 'studio'
  | 'concertHall'
  | 'largeHall'
  | 'cathedral'
  | 'cinema'
  | 'openSpace'
  | 'custom';

export type Quality = 0 | 1 | 2;

/** Everything the DSP engine does, as the user sees it. Persisted. */
export interface StudioSettings {
  enabled: boolean;
  quality: Quality;
  // position + movement
  azimuth: number;
  elevation: number;
  distance: number;
  pattern: MovementPattern;
  rpm: number;
  moveIntensity: number;
  sourceMode: SourceMode;
  // spatial depth
  surround: number;
  hrtf: number;
  width: number;
  roomDepth: number;
  frontRear: number;
  speakers: number[];
  // reverb
  room: RoomPreset;
  reverbMix: number;
  reverbDecay: number;
  roomSize: number;
  reverbDamp: number;
  echo: number;
  predelay: number;
  // EQ
  eqEnabled: boolean;
  preamp: number;
  eq: number[];
  bass: number;
  treble: number;
  vocal: number;
  // smoothness + dynamics
  warmth: number;
  harshness: number;
  smoothing: number;
  compressor: number;
  loudness: number;
  output: number;
  limiter: boolean;
}

export interface SpatialPreset {
  id: string;
  name: string;
  /** Built-in presets can be edited (saved as an override) and restored. */
  builtIn: boolean;
  settings: Partial<StudioSettings>;
}

export interface EqProfile {
  id: string;
  name: string;
  builtIn: boolean;
  preamp: number;
  eq: number[];
  bass: number;
  treble: number;
  vocal: number;
}
