import NativeScreenOcr from '@/specs/NativeScreenOcr';
import { logger } from '@/shared/utils';
import type { PaginationTargetStatus, TargetProblem } from '../capture.types';

const PROBLEMS: readonly TargetProblem[] = [
  'none',
  'rotated',
  'resized',
  'density_changed',
  'out_of_bounds',
  'not_identifiable',
];

/**
 * Parses the native target report. The native side validates the pin
 * against the current screen; anything malformed is treated as not pinned,
 * never as usable.
 */
export function parseTargetStatus(json: string): PaginationTargetStatus | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json) as Record<string, unknown>;
    if (typeof r.x !== 'number' || typeof r.y !== 'number') return null;
    const node = r.node as Record<string, unknown> | undefined;
    const problem = PROBLEMS.includes(r.problem as TargetProblem)
      ? (r.problem as TargetProblem)
      : 'out_of_bounds';
    return {
      x: r.x,
      y: r.y,
      anchor: r.anchor === 'content' ? 'content' : 'screen',
      packageName: typeof r.packageName === 'string' ? r.packageName : '',
      calibratedAt: typeof r.calibratedAt === 'number' ? r.calibratedAt : 0,
      hasNode: Boolean(
        node && (node.viewId || node.contentDescription || node.text),
      ),
      problem,
    };
  } catch {
    return null;
  }
}

export type CalibrationOutcome = 'started' | 'not_running' | 'unsupported';

/** The pinned Next Page button for Speak with pagination. */
export const paginationService = {
  async getTarget(): Promise<PaginationTargetStatus | null> {
    if (!NativeScreenOcr) return null;
    try {
      return parseTargetStatus(await NativeScreenOcr.getPaginationTarget());
    } catch (error) {
      logger.error('pagination.getTarget failed', error);
      return null;
    }
  },

  clearTarget(): void {
    NativeScreenOcr?.clearPaginationTarget();
  },

  /** Shows the crosshair over other apps; needs the floating button running. */
  async startCalibration(): Promise<CalibrationOutcome> {
    if (!NativeScreenOcr) return 'unsupported';
    try {
      return (await NativeScreenOcr.startTargetCalibration()) === 'started'
        ? 'started'
        : 'not_running';
    } catch (error) {
      logger.error('pagination.startCalibration failed', error);
      return 'not_running';
    }
  },
};
