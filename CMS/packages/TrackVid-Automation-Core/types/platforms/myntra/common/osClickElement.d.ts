/**
 * Clicks `element` with the OS mouse, `times` times, `gapMs` apart.
 *
 * @returns {Promise<{ x: number, y: number, source: string, verified: boolean }>}
 *          where it clicked, how that position was arrived at, and whether the
 *          page confirmed the mouse was on the element before clicking.
 */
export function osClickElement(driver: any, element: any, { times, gapMs, log }?: {
    times?: number;
    gapMs?: number;
    log?: {
        (...data: any[]): void;
        (message?: any, ...optionalParams: any[]): void;
    };
}): Promise<{
    x: number;
    y: number;
    source: string;
    verified: boolean;
}>;
/**
 * The element's centre on screen, in DIPs, and the candidate positions to try
 * in robotjs's space — most likely first.
 *
 * Exported for tests: pure arithmetic over `readGeometry`'s answer.
 */
export function screenCandidates(geometry: any, robotScreen: any): {
    centre: {
        x: any;
        y: any;
    };
    scale: number;
    candidates: {
        x: number;
        y: number;
        how: string;
    }[];
};
