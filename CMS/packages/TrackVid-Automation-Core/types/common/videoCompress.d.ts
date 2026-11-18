/**
 * Re-encodes `input` to land just under `maxBytes`, and returns where it landed.
 *
 * Never throws for a video it cannot shrink — the caller is mid-claim, and a
 * compression problem must not become the reason a claim with good evidence is
 * abandoned. The original path comes back with a `reason`, and the upload then
 * succeeds or fails on its own terms exactly as it did before.
 *
 * @param {string} input
 * @param {object} options
 * @param {number} options.maxBytes        the marketplace's hard cap
 * @param {number} [options.targetBytes]   what to aim for; defaults to just under the cap
 * @param {string} [options.tempDir]       where to write; defaults beside the input
 * @param {object} [options.logger]
 * @returns {Promise<{path: string, compressed: boolean, from: number, to: number, reason: string|null}>}
 */
export function fitVideoToLimit(input: string, { maxBytes, targetBytes, tempDir, logger }?: {
    maxBytes: number;
    targetBytes?: number;
    tempDir?: string;
    logger?: object;
}): Promise<{
    path: string;
    compressed: boolean;
    from: number;
    to: number;
    reason: string | null;
}>;
/**
 * The bitrate to try next, given what the last one actually produced.
 *
 * Exact in principle: size is bitrate times duration, so if `achieved` bytes
 * came out of `bitrate`, then `target` bytes need `bitrate × target/achieved`.
 * The extra 3% off is for the muxing overhead the arithmetic cannot see —
 * landing exactly on a cap is a failed upload after a two-minute encode.
 *
 * Pure, and exported, because it is the whole correction: the encode around it
 * is ffmpeg's business, and this is the part that has to be right.
 */
export function correctedBitrate(bitrate: any, target: any, achieved: any): any;
/**
 * Where ffmpeg and ffprobe are, if they are anywhere.
 *
 * Three places, in order of how deliberate they are: an explicit path, a
 * bundled binary, then whatever is on PATH. `ffmpeg-static` is a lazy require in
 * a try/catch because neither consumer depends on it — see this package's
 * CLAUDE.md on optional dependencies.
 */
export function resolveBinaries(): {
    ffmpeg: string;
    ffprobe: string;
};
/**
 * The least bitrate (bits/sec) at which each height still looks like evidence.
 *
 * Not quality targets — floors. Below its floor a height is the wrong height,
 * and the frame is scaled down instead.
 */
export const HEIGHT_FLOORS: {
    height: number;
    floor: number;
}[];
