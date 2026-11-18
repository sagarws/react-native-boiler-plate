/**
 * Bubble level maths from the gravity vector (device axes: x right, y up the
 * screen, z out of the screen; at rest the sensor reads +g pointing up, so a
 * phone flat on a table reads ≈ (0, 0, 1)). Pure; angles in degrees.
 */

export interface Gravity {
  x: number;
  y: number;
  z: number;
}

export interface LevelCalibration {
  x: number;
  y: number;
  edge: number;
}

export const NO_CALIBRATION: LevelCalibration = { x: 0, y: 0, edge: 0 };

export type LevelReading =
  | {
      /** Lying (nearly) flat: two tilts, left–right and front–back. */
      mode: 'flat';
      /** + when the right side is higher. */
      x: number;
      /** + when the top edge is higher. */
      y: number;
      level: boolean;
    }
  | {
      /** Standing on an edge: one angle in the screen's plane. */
      mode: 'edge';
      /** Off the nearest horizontal / vertical, + clockwise. */
      angle: number;
      level: boolean;
    };

/** Within this many degrees counts as level. */
export const LEVEL_TOLERANCE = 0.5;
/** Flat when the screen faces within ~45° of straight up or down. */
const FLAT_Z = Math.SQRT1_2;

const deg = (r: number) => (r * 180) / Math.PI;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The raw angles a calibration zeroes out. */
export function rawAngles(g: Gravity): LevelCalibration {
  // The higher side is where the device axis tilts towards "up", so its
  // gravity-sensor component is positive there (face up or face down).
  const z = Math.abs(g.z);
  // Rotating the phone clockwise in its own plane tips +x downwards.
  const edge = deg(Math.atan2(-g.x, g.y));
  return {
    x: deg(Math.atan2(g.x, z)),
    y: deg(Math.atan2(g.y, z)),
    edge: edge - Math.round(edge / 90) * 90,
  };
}

export function levelReading(
  g: Gravity,
  cal: LevelCalibration = NO_CALIBRATION,
): LevelReading | null {
  const n = Math.hypot(g.x, g.y, g.z);
  if (!(n > 0.1)) return null;
  const u = { x: g.x / n, y: g.y / n, z: g.z / n };
  const raw = rawAngles(u);
  if (Math.abs(u.z) >= FLAT_Z) {
    const x = round1(raw.x - cal.x);
    const y = round1(raw.y - cal.y);
    return {
      mode: 'flat',
      x,
      y,
      level: Math.abs(x) <= LEVEL_TOLERANCE && Math.abs(y) <= LEVEL_TOLERANCE,
    };
  }
  let angle = raw.edge - cal.edge;
  angle -= Math.round(angle / 90) * 90;
  angle = round1(angle);
  return { mode: 'edge', angle, level: Math.abs(angle) <= LEVEL_TOLERANCE };
}

/**
 * Where the bubble sits in a circle of [radius] (flat mode): it floats to
 * the higher side, and stops at the rim from [fullScale]° on.
 */
export function bubbleOffset(
  x: number,
  y: number,
  radius: number,
  fullScale = 10,
): { dx: number; dy: number } {
  let dx = (x / fullScale) * radius;
  // Screen y grows downwards; the top edge higher (+y) floats the bubble up.
  let dy = (-y / fullScale) * radius;
  const r = Math.hypot(dx, dy);
  if (r > radius) {
    dx = (dx / r) * radius;
    dy = (dy / r) * radius;
  }
  return { dx, dy };
}
