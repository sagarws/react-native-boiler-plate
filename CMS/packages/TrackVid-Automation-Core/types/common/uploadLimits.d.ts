export namespace UPLOAD_LIMITS {
    let meesho: number;
    let snapdeal: number;
}
/**
 * The cap for one platform, or null when it has never stated one.
 *
 * @param {string} platform any spelling — see platformKey
 * @returns {number|null}
 */
export function uploadLimitFor(platform: string): number | null;
/** Platforms with a known cap, for a caller that has to offer a choice per platform. */
export function platformsWithUploadLimit(): string[];
