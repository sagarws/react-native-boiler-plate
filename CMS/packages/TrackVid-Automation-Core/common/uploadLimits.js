// -----------------------------------------------------------------------------
// How large an attachment each marketplace will accept
// -----------------------------------------------------------------------------
// One map, because three different places need the same number and none of them
// should be the one that knows it: the claim runner (to shrink a video before
// uploading), the desktop app's "Download Resource" (to offer the operator a
// copy that will actually upload when they file by hand), and any message that
// has to say what the limit is.
//
// COUNTED IN MILLIONS, not MiB. A marketplace states its cap as "25MB" and does
// not say which, and the two are 1.2MB apart — so a file sized against MiB is a
// file the server may still refuse, after two minutes of encoding. Read as
// millions we are under either reading and give up 4% of the quality budget,
// which nobody can see. See common/videoCompress.js.
//
// ABSENT MEANS UNKNOWN, not unlimited. A platform with no entry here has never
// told us a number, and a caller must treat that as "do not touch the file"
// rather than inventing a cap to compress against.
// -----------------------------------------------------------------------------

const { platformKey } = require("./platforms.js");

/**
 * Platform → the largest single attachment it has been seen to accept, in bytes.
 *
 * Meesho's is from its own refusal — "HTTP 400 File too large. Maximum size:
 * 25MB" — which is the only statement of it anybody has. Each is overridable by
 * environment variable for the day one moves, because a limit that changes
 * upstream should not need a release here.
 */
const UPLOAD_LIMITS = {
    meesho: Number(process.env.MEESHO_MAX_UPLOAD_BYTES || 25_000_000),
    // Snapdeal states its own: "File is too large. Please upload maximum of 5
    // MB files". Five times tighter than Meesho's, which changes WHICH files
    // are the problem — a phone photo clears 5MB on its own, before anybody
    // films anything, so the cap has to be applied to every attachment rather
    // than only to the video. See common/attachmentCompress.js.
    snapdeal: Number(process.env.SNAPDEAL_MAX_UPLOAD_BYTES || 5_000_000),
};

/**
 * The cap for one platform, or null when it has never stated one.
 *
 * @param {string} platform any spelling — see platformKey
 * @returns {number|null}
 */
function uploadLimitFor(platform) {
    const limit = UPLOAD_LIMITS[platformKey(platform)];

    return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/** Platforms with a known cap, for a caller that has to offer a choice per platform. */
function platformsWithUploadLimit() {
    return Object.keys(UPLOAD_LIMITS);
}

module.exports = { UPLOAD_LIMITS, uploadLimitFor, platformsWithUploadLimit };
