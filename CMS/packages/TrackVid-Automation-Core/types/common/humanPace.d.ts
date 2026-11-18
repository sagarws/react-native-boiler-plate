/**
 * Spacing requests out the way a person would.
 *
 * A marketplace that sees forty identical requests exactly five seconds apart
 * is not looking at a person, and the platforms these runners talk to all
 * rate-limit or challenge on that pattern eventually. A randomised gap costs
 * nothing and does not look like a script.
 *
 * DELIBERATELY STATELESS. Nykaa's claim pacer keeps a rate BUDGET — how many
 * calls in the last minute, and how far behind an ideal schedule it has fallen
 * — which is a different and larger job; it borrows `jitter` from here rather
 * than the other way round. What is shared is the arithmetic, which is the part
 * that was about to exist twice.
 */
/**
 * A random value within `ratio` either side of `baseMs`.
 *
 * `jitter(5000, 0.35)` lands somewhere in 3.25s–6.75s. The spread matters more
 * than the centre: identical gaps are the tell, not fast ones.
 */
export function jitter(baseMs: any, ratio?: number): number;
/** One randomised gap, never negative. */
export function humanGapMs(baseMs: any, ratio?: number): number;
/**
 * Waits a randomised gap — unless this is the first item.
 *
 * The index matters: pausing before the first of a run makes an operator watch
 * a spinner for five seconds before anything has happened, and there is nothing
 * yet to be spaced apart FROM.
 *
 * @param {number} index    zero-based position in the run
 * @param {object} [options]
 * @param {number} [options.baseMs]
 * @param {number} [options.ratio]
 * @param {(ms: number) => void} [options.onWait]  told the gap it is about to take
 */
export function pacedPause(index: number, { baseMs, ratio, onWait }?: {
    baseMs?: number;
    ratio?: number;
    onWait?: (ms: number) => void;
}): Promise<number>;
