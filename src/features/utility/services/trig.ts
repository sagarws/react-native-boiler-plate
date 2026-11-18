/**
 * Angle (clinometer) measuring: the user enters one known length, aims the
 * camera's crosshair at points, and the phone's tilt gives each point's
 * elevation angle (degrees, + above the horizon, − below). Trigonometry
 * does the rest. Pure; lengths in metres.
 *
 * Methods:
 * - heightFromDistance: horizontal distance D to the object known.
 *   H = D · (tan top − tan base).
 * - heightFromDeviceHeight: the camera's height h above the floor known.
 *   D = h / tan(−base) (base must be below the horizon), then as above.
 * - distanceFromDeviceHeight: D = h / tan(−point).
 * - floorLength: two floor points; each distance as above, then the law of
 *   cosines with the horizontal turn Δ between them:
 *   L = √(d1² + d2² − 2·d1·d2·cos Δ). Without a turn reading (no rotation
 *   sensor) Δ = 0, i.e. the points must be in line with you.
 */

export const TRIG_METHODS = [
  'heightFromDistance',
  'heightFromDeviceHeight',
  'distanceFromDeviceHeight',
  'floorLength',
] as const;
export type TrigMethod = (typeof TRIG_METHODS)[number];

/** Which known length each method asks for. */
export const KNOWN_INPUT: Record<TrigMethod, 'distance' | 'deviceHeight'> = {
  heightFromDistance: 'distance',
  heightFromDeviceHeight: 'deviceHeight',
  distanceFromDeviceHeight: 'deviceHeight',
  floorLength: 'deviceHeight',
};

/** Sighting steps, in order (i18n keys `utility.sight_<step>`). */
export const STEPS: Record<TrigMethod, readonly SightStep[]> = {
  heightFromDistance: ['base', 'top'],
  heightFromDeviceHeight: ['base', 'top'],
  distanceFromDeviceHeight: ['floorPoint'],
  floorLength: ['floorStart', 'floorEnd'],
};
export type SightStep =
  | 'base'
  | 'top'
  | 'floorPoint'
  | 'floorStart'
  | 'floorEnd';

/** What the result is, for saving with the other measurements. */
export const RESULT_MODE: Record<TrigMethod, 'height' | 'distance' | 'length'> =
  {
    heightFromDistance: 'height',
    heightFromDeviceHeight: 'height',
    distanceFromDeviceHeight: 'distance',
    floorLength: 'length',
  };

export interface Sight {
  /** Elevation of the camera's aim, degrees (+ up). */
  elevation: number;
  /** Compass-style heading of the aim, degrees; null without a rotation sensor. */
  azimuth: number | null;
}

export type TrigError =
  | 'known_invalid'
  | 'angles_missing'
  /** The top was aimed below (or at) the base. */
  | 'top_below_base'
  /** A floor point was aimed at or above the horizon. */
  | 'not_below_horizon'
  /** Too close to straight up / down to be meaningful. */
  | 'too_steep';

export type TrigResult =
  | {
      ok: true;
      meters: number;
      /** Horizontal distance(s) worked out on the way (for display). */
      distances: number[];
      /** Worst-case spread if each angle were off by ±ERROR_DEG. */
      uncertainty: number;
      /** Aimed close to the horizon: small angle errors matter a lot. */
      lowAngle: boolean;
      /** floorLength without a heading: assumed in line. */
      assumedInLine: boolean;
    }
  | { ok: false; error: TrigError };

/** Angle error assumed for the ± shown with each result. */
export const ERROR_DEG = 0.5;
const MAX_ANGLE = 85;
/** Below this depression angle a floor distance gets imprecise. */
const LOW_ANGLE = 8;
const MAX_KNOWN_M = 10_000;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Signed smallest difference b − a between two headings, degrees. */
export function headingDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

type Core = { meters: number; distances: number[] } | TrigError;

function core(
  method: TrigMethod,
  known: number,
  e: number[],
  turn: number,
): Core {
  if (e.some(a => Math.abs(a) > MAX_ANGLE)) return 'too_steep';
  switch (method) {
    case 'heightFromDistance': {
      const [base, top] = e;
      if (top <= base) return 'top_below_base';
      return {
        meters: known * (Math.tan(rad(top)) - Math.tan(rad(base))),
        distances: [known],
      };
    }
    case 'heightFromDeviceHeight': {
      const [base, top] = e;
      if (base >= 0) return 'not_below_horizon';
      if (top <= base) return 'top_below_base';
      const d = known / Math.tan(rad(-base));
      return {
        meters: d * (Math.tan(rad(top)) - Math.tan(rad(base))),
        distances: [d],
      };
    }
    case 'distanceFromDeviceHeight': {
      const [p] = e;
      if (p >= 0) return 'not_below_horizon';
      const d = known / Math.tan(rad(-p));
      return { meters: d, distances: [d] };
    }
    case 'floorLength': {
      const [a, b] = e;
      if (a >= 0 || b >= 0) return 'not_below_horizon';
      const d1 = known / Math.tan(rad(-a));
      const d2 = known / Math.tan(rad(-b));
      const l2 = d1 * d1 + d2 * d2 - 2 * d1 * d2 * Math.cos(rad(turn));
      return { meters: Math.sqrt(Math.max(0, l2)), distances: [d1, d2] };
    }
  }
}

/**
 * Works out the measurement from the known length (metres) and the sights,
 * with a ± from re-running it with every angle nudged by ±ERROR_DEG.
 */
export function solveTrig(
  method: TrigMethod,
  knownMeters: number,
  sights: readonly Sight[],
): TrigResult {
  if (!(knownMeters > 0) || knownMeters > MAX_KNOWN_M)
    return { ok: false, error: 'known_invalid' };
  const need = STEPS[method].length;
  if (
    sights.length < need ||
    sights.slice(0, need).some(s => !Number.isFinite(s.elevation))
  )
    return { ok: false, error: 'angles_missing' };
  const e = sights.slice(0, need).map(s => s.elevation);
  const [s1, s2] = sights;
  const hasTurn =
    method === 'floorLength' && s1.azimuth !== null && s2?.azimuth != null;
  const turn = hasTurn ? headingDelta(s1.azimuth!, s2.azimuth!) : 0;
  const main = core(method, knownMeters, e, turn);
  if (typeof main === 'string') return { ok: false, error: main };

  // Every ± combination of the angles (2 or 4 runs).
  let combos: number[][] = [[]];
  for (const a of e)
    combos = combos.flatMap(c => [
      [...c, a - ERROR_DEG],
      [...c, a + ERROR_DEG],
    ]);
  let spread = 0;
  for (const nudged of combos) {
    const alt = core(method, knownMeters, nudged, turn);
    if (typeof alt !== 'string')
      spread = Math.max(spread, Math.abs(alt.meters - main.meters));
    // A nudge that breaks the geometry means the result is very sensitive.
    else spread = Math.max(spread, main.meters);
  }
  const floorAngles =
    method === 'heightFromDistance'
      ? []
      : method === 'heightFromDeviceHeight'
      ? [e[0]]
      : e;
  return {
    ok: true,
    meters: main.meters,
    distances: main.distances,
    uncertainty: spread,
    lowAngle: floorAngles.some(a => Math.abs(a) < LOW_ANGLE),
    assumedInLine: method === 'floorLength' && !hasTurn,
  };
}
