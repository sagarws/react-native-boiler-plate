import type { MovementPattern, SourceMode, StudioSettings } from '../types';

/*
 * The native engine's parameter array. Same order and ranges as
 * android/spatialaudio/src/main/java/com/rnboilerplate/spatialaudio/SpatialParams.kt
 * — keep the two lists identical.
 */
export const P = {
  ENABLED: 0,
  QUALITY: 1,
  AZIMUTH: 2,
  ELEVATION: 3,
  DISTANCE: 4,
  PATTERN: 5,
  RPM: 6,
  MOVE_INTENSITY: 7,
  SOURCE_MODE: 8,
  SURROUND: 9,
  HRTF: 10,
  WIDTH: 11,
  ROOM_DEPTH: 12,
  FRONT_REAR: 13,
  REVERB_MIX: 14,
  REVERB_DECAY: 15,
  ROOM_SIZE: 16,
  REVERB_DAMP: 17,
  ECHO: 18,
  PREDELAY: 19,
  PREAMP: 20,
  EQ_0: 21,
  BASS: 31,
  TREBLE: 32,
  VOCAL: 33,
  WARMTH: 34,
  HARSHNESS: 35,
  SMOOTHING: 36,
  COMPRESSOR: 37,
  LOUDNESS: 38,
  OUTPUT: 39,
  LIMITER: 40,
  SPEAKER_0: 41,
  EQ_ENABLED: 49,
  COUNT: 50,
} as const;

export const EQ_BANDS_HZ = [
  31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;

/** Virtual speaker order in the engine: FL, FR, SL, SR, RL, RR, UL, UR. */
export const SPEAKERS = [
  'FL',
  'FR',
  'SL',
  'SR',
  'RL',
  'RR',
  'UL',
  'UR',
] as const;

/** Speaker directions (degrees; 0 front, +90 right) and heights, for the studio view. */
export const SPEAKER_POSITIONS: Record<
  (typeof SPEAKERS)[number],
  { azimuth: number; elevation: number }
> = {
  FL: { azimuth: -30, elevation: 0 },
  FR: { azimuth: 30, elevation: 0 },
  SL: { azimuth: -90, elevation: 0 },
  SR: { azimuth: 90, elevation: 0 },
  RL: { azimuth: -150, elevation: 0 },
  RR: { azimuth: 150, elevation: 0 },
  UL: { azimuth: -45, elevation: 45 },
  UR: { azimuth: 45, elevation: 45 },
};

export const PATTERNS: readonly MovementPattern[] = [
  'static',
  'clockwise',
  'anticlockwise',
  'leftRight',
  'rightLeft',
  'frontBack',
  'backFront',
  'random',
  'wave',
  'figure8',
];

const SOURCE_MODES: readonly SourceMode[] = [
  'single',
  'stereoPair',
  'vocalBed',
];

const clamp = (v: number, lo: number, hi: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;

/** Settings → the float array the engine takes (clamped to its ranges). */
export function toParamArray(s: StudioSettings): number[] {
  const p = new Array<number>(P.COUNT).fill(0);
  p[P.ENABLED] = s.enabled ? 1 : 0;
  p[P.QUALITY] = s.quality;
  p[P.AZIMUTH] = clamp(s.azimuth, -180, 180);
  p[P.ELEVATION] = clamp(s.elevation, -40, 70);
  p[P.DISTANCE] = clamp(s.distance, 0, 1);
  p[P.PATTERN] = Math.max(0, PATTERNS.indexOf(s.pattern));
  p[P.RPM] = clamp(s.rpm, 0, 60);
  p[P.MOVE_INTENSITY] = clamp(s.moveIntensity, 0, 1);
  p[P.SOURCE_MODE] = Math.max(0, SOURCE_MODES.indexOf(s.sourceMode));
  p[P.SURROUND] = clamp(s.surround, 0, 1);
  p[P.HRTF] = clamp(s.hrtf, 0, 1);
  p[P.WIDTH] = clamp(s.width, 0, 2);
  p[P.ROOM_DEPTH] = clamp(s.roomDepth, 0, 1);
  p[P.FRONT_REAR] = clamp(s.frontRear, 0, 1);
  p[P.REVERB_MIX] = clamp(s.reverbMix, 0, 1);
  p[P.REVERB_DECAY] = clamp(s.reverbDecay, 0.2, 8);
  p[P.ROOM_SIZE] = clamp(s.roomSize, 0, 1);
  p[P.REVERB_DAMP] = clamp(s.reverbDamp, 0, 1);
  p[P.ECHO] = clamp(s.echo, 0, 1);
  p[P.PREDELAY] = clamp(s.predelay, 0, 100);
  p[P.PREAMP] = clamp(s.preamp, -12, 6);
  for (let i = 0; i < 10; i++) p[P.EQ_0 + i] = clamp(s.eq[i] ?? 0, -12, 12);
  p[P.BASS] = clamp(s.bass, 0, 12);
  p[P.TREBLE] = clamp(s.treble, -12, 12);
  p[P.VOCAL] = clamp(s.vocal, 0, 1);
  p[P.WARMTH] = clamp(s.warmth, 0, 1);
  p[P.HARSHNESS] = clamp(s.harshness, 0, 1);
  p[P.SMOOTHING] = clamp(s.smoothing, 0, 1);
  p[P.COMPRESSOR] = clamp(s.compressor, 0, 1);
  p[P.LOUDNESS] = clamp(s.loudness, 0, 1);
  p[P.OUTPUT] = clamp(s.output, -12, 6);
  p[P.LIMITER] = s.limiter ? 1 : 0;
  for (let i = 0; i < 8; i++)
    p[P.SPEAKER_0 + i] = clamp(s.speakers[i] ?? 1, 0, 1.5);
  p[P.EQ_ENABLED] = s.eqEnabled ? 1 : 0;
  return p;
}

/** Rotation-speed names (the spec's Very Slow … Very Fast) → RPM. */
export const SPEED_STEPS = [
  { key: 'verySlow', rpm: 2 },
  { key: 'slow', rpm: 5 },
  { key: 'normal', rpm: 10 },
  { key: 'fast', rpm: 20 },
  { key: 'veryFast', rpm: 40 },
] as const;

/** Distance names → 0–1. */
export const DISTANCE_STEPS = [
  { key: 'extremelyNear', value: 0 },
  { key: 'near', value: 0.25 },
  { key: 'medium', value: 0.5 },
  { key: 'far', value: 0.75 },
  { key: 'veryFar', value: 1 },
] as const;

export const distanceName = (d: number) =>
  DISTANCE_STEPS.reduce((best, s) =>
    Math.abs(s.value - d) < Math.abs(best.value - d) ? s : best,
  ).key;
