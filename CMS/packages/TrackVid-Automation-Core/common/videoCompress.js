// -----------------------------------------------------------------------------
// Fitting a video inside a marketplace's upload limit
// -----------------------------------------------------------------------------
// Every marketplace caps the evidence it will accept, and the cap is small:
// Meesho refuses anything over 25MB with a bare HTTP 400. A modern phone shoots
// well past that in under a minute, so the unpacking video — the single most
// persuasive thing a claim can carry — is exactly the attachment most likely to
// be refused. The claim then fails with UPLOAD_FAILED and nobody files it at all.
//
// THE GOAL IS THE LARGEST FILE THAT FITS, not the smallest file possible. A
// claim is won or lost on whether a reviewer can see the damage, so squeezing a
// 40MB video into 5MB to be safe would be a technically successful upload of
// useless evidence. The budget is therefore spent deliberately: the duration
// decides the bitrate, and the bitrate is whatever lands just under the cap.
//
// HOW THE BITRATE IS CHOSEN. Size is bitrate times duration, so the arithmetic
// runs backwards from the target: a 24MB budget over 90 seconds is about
// 2.1 Mbit/s all in. Two-pass, because a single pass misses the target by enough
// to matter when the margin is one megabyte — the first pass measures the
// footage and the second spends the budget where the motion is.
//
// AND THEN IT IS MEASURED, because that arithmetic can be wrong. A 25.2MB clip
// was encoded at 3953kbps for a 24.6MB target and came out at 30.5MB — the
// duration ffprobe reported was shorter than what ffmpeg actually encoded, so
// every second of the overrun was spent at full bitrate. The first version gave
// up there, and a claim failed over 0.2MB.
//
// A measured miss is the one thing that CAN be corrected exactly: the achieved
// size says what the bitrate really buys, so the next attempt scales by
// target/achieved and lands. That is worth one more encode, and no more than
// two — past that the arithmetic is not the problem.
//
// RESOLUTION IS DROPPED BEFORE QUALITY IS. Starving 1080p of bitrate produces a
// blocky mess; the same bitrate at 720p looks clean. So when the budget is too
// thin for the source height, the frame is scaled down to the largest standard
// height the budget can actually serve. Never upscaled, and never below 360p —
// past that the video has stopped being evidence.
//
// FFMPEG IS OPTIONAL, like every other runtime dependency here. It is resolved
// when a video actually needs shrinking, and its absence is reported as a reason
// rather than thrown: a machine without it behaves exactly as it did before this
// existed — the oversized upload fails, with a message saying why.
// -----------------------------------------------------------------------------

const path = require("path");

/**
 * Container and muxing overhead the bitrate arithmetic cannot see.
 *
 * Small, because two-pass is accurate — measured at about half a percent under
 * target on real footage — and every point of margin here is quality given up
 * for nothing. The real safety net is the size check after the encode, not a
 * timid budget.
 */
const OVERHEAD = 0.99;

/**
 * The least bitrate (bits/sec) at which each height still looks like evidence.
 *
 * Not quality targets — floors. Below its floor a height is the wrong height,
 * and the frame is scaled down instead.
 */
const HEIGHT_FLOORS = [
    { height: 1080, floor: 2_000_000 },
    { height: 720, floor: 1_000_000 },
    { height: 480, floor: 600_000 },
    { height: 360, floor: 300_000 },
];

/**
 * Bytes as MB, counted in MILLIONS.
 *
 * Deliberately not MiB. Every number this module prints sits next to a
 * marketplace's own statement of its limit — "Maximum size: 25MB" — and a cap
 * of 25 million bytes rendered in MiB reads as "23.8MB", which looks like the
 * code inventing a stricter rule than the one it was given. macOS reports file
 * sizes the same way, so an operator comparing with Finder sees the same
 * number too.
 */
const round = (bytes) => `${(bytes / 1_000_000).toFixed(1)}MB`;

/** Runs a binary and resolves its stdout. Rejects with stderr, which is where ffmpeg talks. */
function run(file, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
    const { execFile } = require("child_process");

    return new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                err.message = `${file} failed: ${String(stderr || err.message).slice(-500)}`;
                reject(err);

                return;
            }

            resolve(String(stdout || ""));
        });
    });
}

/**
 * Where ffmpeg and ffprobe are, if they are anywhere.
 *
 * Three places, in order of how deliberate they are: an explicit path, a
 * bundled binary, then whatever is on PATH. `ffmpeg-static` is a lazy require in
 * a try/catch because neither consumer depends on it — see this package's
 * CLAUDE.md on optional dependencies.
 */
function resolveBinaries() {
    const fromEnv = {
        ffmpeg: process.env.FFMPEG_PATH || "",
        ffprobe: process.env.FFPROBE_PATH || "",
    };

    if (fromEnv.ffmpeg && fromEnv.ffprobe) return fromEnv;

    let ffmpeg = fromEnv.ffmpeg;
    let ffprobe = fromEnv.ffprobe;

    if (!ffmpeg) {
        try {
            const bundled = require("ffmpeg-static");

            if (typeof bundled === "string" && bundled) ffmpeg = bundled;
        } catch {
            // Not installed here. Fall through to PATH.
        }
    }

    // Literal specifiers, never a computed one, even though two lookups in a
    // row reads like a loop: Trackvid-CMS bundles its main process, and a
    // bundler cannot follow `require(variable)` — see this package's CLAUDE.md.
    //
    // The installer package is preferred because it downloads only the running
    // platform's binary. `ffprobe-static` ships every platform's — 346MB
    // unpacked — which is not something to put inside a desktop installer.
    if (!ffprobe) {
        try {
            const bundled = require("@ffprobe-installer/ffprobe");

            if (bundled && typeof bundled.path === "string") ffprobe = bundled.path;
        } catch {
            // Not installed here.
        }
    }

    if (!ffprobe) {
        try {
            const bundled = require("ffprobe-static");

            if (bundled && typeof bundled.path === "string") ffprobe = bundled.path;
        } catch {
            // Nor this one. Fall through to PATH.
        }
    }

    return { ffmpeg: ffmpeg || "ffmpeg", ffprobe: ffprobe || "ffprobe" };
}

/** Duration, frame height and whether there is any audio to budget for. */
async function probe(ffprobe, filePath) {
    const out = await run(ffprobe, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
    ]);

    const info = JSON.parse(out);
    const streams = Array.isArray(info.streams) ? info.streams : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const duration = Number(info.format?.duration || video?.duration || 0);

    return {
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        height: Number(video?.height) || 0,
        width: Number(video?.width) || 0,
        hasAudio: streams.some((stream) => stream.codec_type === "audio"),
    };
}

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
function correctedBitrate(bitrate, target, achieved) {
    if (!achieved || achieved <= 0) return bitrate;

    return Math.floor(bitrate * (target / achieved) * 0.97);
}

/** The tallest standard height this budget can actually serve, never taller than the source. */
function heightFor(videoBitrate, sourceHeight) {
    const usable = HEIGHT_FLOORS.filter(
        (entry) => entry.floor <= videoBitrate && (!sourceHeight || entry.height <= sourceHeight)
    );

    // Nothing clears its floor: take the smallest rung rather than refusing.
    // A soft 360p still shows a torn packet; no upload shows nothing.
    if (usable.length === 0) return Math.min(sourceHeight || 360, 360);

    return usable[0].height;
}

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
async function fitVideoToLimit(input, { maxBytes, targetBytes, tempDir, logger } = {}) {
    const fs = require("fs-extra");
    const log = logger || console;

    if (!maxBytes || maxBytes <= 0) throw new Error("fitVideoToLimit: maxBytes is required");

    const original = (await fs.stat(input)).size;
    const unchanged = (reason) => ({ path: input, compressed: false, from: original, to: original, reason });

    if (original <= maxBytes) return unchanged(null);

    // Just under the cap, not at it: the muxer's own overhead is not in the
    // bitrate arithmetic, and landing at 25.0MB against a 25MB limit is a
    // failed upload after a two-minute encode. Close under, though — the point
    // is to spend the budget, so a 25MB cap aims at roughly 24MB rather than
    // retreating to something comfortable.
    //
    // The headroom is PROPORTIONAL, with a ceiling. A flat subtraction goes
    // negative against a small cap — a 300KB limit came out as a target of
    // minus 0.1MB, and the refusal that followed said so out loud.
    const headroom = Math.min(384 * 1024, Math.floor(maxBytes * 0.03));
    const target = Math.max(0, targetBytes || maxBytes - headroom);

    const { ffmpeg, ffprobe } = resolveBinaries();
    let media;

    try {
        media = await probe(ffprobe, input);
    } catch (err) {
        // Almost always "ffprobe not found". Said plainly, because the fix is
        // an install rather than anything in this code.
        return unchanged(`could not read the video (${err.message.slice(0, 200)})`);
    }

    if (!media.duration) return unchanged("the video reports no duration, so no bitrate can be chosen");

    // Audio first, because it is a fixed cost: what is left is the video's.
    const audioBitrate = media.hasAudio ? (media.duration > 300 ? 64_000 : 96_000) : 0;
    const totalBitrate = Math.floor((target * 8 * OVERHEAD) / media.duration);
    const videoBitrate = totalBitrate - audioBitrate;

    if (videoBitrate < 120_000) {
        // A 24MB budget over an hour of footage. Encoding it would produce
        // something nobody can adjudicate, and would take minutes to do it.
        return unchanged(
            `${Math.round(media.duration)}s of video cannot be fitted into ${round(target)} without ruining it`
        );
    }

    const output = path.join(
        tempDir || path.dirname(input),
        `${path.basename(input, path.extname(input))}_fit.mp4`
    );

    /**
     * One two-pass encode at a given bitrate. Returns the size it produced.
     *
     * Separated out so the caller can measure and try again: everything about
     * an encode is decided by the bitrate, and the bitrate is the one thing
     * that turned out to need correcting.
     */
    const encodeAt = async (bitrate, attempt) => {
        const height = heightFor(bitrate, media.height);
        const scale = media.height && height < media.height ? ["-vf", `scale=-2:${height}`] : [];
        const passLog = path.join(tempDir || path.dirname(input), `ffpass_${Date.now()}_${attempt}`);

        const common = [
        "-y",
        "-i",
        input,
        ...scale,
            "-c:v",
            "libx264",
            "-b:v",
            String(bitrate),
            // Keeps a quiet stretch from being spent on, and a busy one from
            // blowing the budget. Without a cap the two-pass average is still an
            // average, and the peak is what overshoots the file size.
            "-maxrate",
            String(Math.floor(bitrate * 1.45)),
            "-bufsize",
            String(bitrate * 2),
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
        ];

        log.info?.(
            `[video] ${round(original)} is over the ${round(maxBytes)} limit — re-encoding to ~${round(target)} ` +
                `at ${height}p, ${Math.round(bitrate / 1000)}kbps` +
                (attempt > 1 ? ` (attempt ${attempt})` : "")
        );

        try {
            // Pass one only measures, and its output is thrown away: `-f null`
            // rather than an mp4 to stdout, which ffmpeg refuses outright because
            // the mp4 muxer has to seek back to write its index.
            await run(ffmpeg, [...common, "-pass", "1", "-passlogfile", passLog, "-an", "-f", "null", "-"], {
                timeoutMs: 15 * 60 * 1000,
            });

            await run(
                ffmpeg,
                [
                    ...common,
                    "-pass",
                    "2",
                    "-passlogfile",
                    passLog,
                    ...(media.hasAudio ? ["-c:a", "aac", "-b:a", String(audioBitrate)] : ["-an"]),
                    // The index at the front, so a reviewer's browser can play it
                    // without downloading the whole file first.
                    "-movflags",
                    "+faststart",
                    output,
                ],
                { timeoutMs: 20 * 60 * 1000 }
            );
        } catch (err) {
            await fs.remove(output).catch(() => {});

            return { failed: `could not re-encode the video (${err.message.slice(0, 200)})` };
        } finally {
            // ffmpeg leaves its statistics behind, and under more names than the
            // documented two: builds differ on whether the ".temp" copies survive.
            // Swept by prefix rather than by a list, so a new suffix does not
            // quietly start littering the operator's temp directory.
            const dir = path.dirname(passLog);
            const prefix = path.basename(passLog);
            const leftovers = await fs.readdir(dir).catch(() => []);

            await Promise.all(
                leftovers
                    .filter((name) => name.startsWith(prefix))
                    .map((name) => fs.remove(path.join(dir, name)).catch(() => {}))
            );
        }

        const size = (await fs.stat(output).catch(() => ({ size: 0 }))).size;

        return size ? { size, height } : { failed: "the re-encode produced no file" };
    };

    // At most three encodes: the arithmetic's guess, and two corrections from
    // what it actually produced. Each correction is exact in principle — the
    // achieved size says what a kilobit really costs on this footage — so a
    // third would be chasing rounding, not a miss.
    const MAX_ATTEMPTS = 3;
    let bitrate = videoBitrate;
    let last = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const result = await encodeAt(bitrate, attempt);

        if (result.failed) return unchanged(result.failed);

        last = result;

        if (result.size <= maxBytes) {
            log.info?.(`[video] ${round(original)} → ${round(result.size)} at ${result.height}p`);

            return { path: output, compressed: true, from: original, to: result.size, reason: null };
        }

        // Over. Scale the bitrate by what this encode proves it buys.
        const corrected = correctedBitrate(bitrate, target, result.size);

        if (attempt === MAX_ATTEMPTS || corrected < 120_000 || corrected >= bitrate) {
            await fs.remove(output).catch(() => {});

            return unchanged(
                `re-encoded to ${round(result.size)} in ${attempt} attempt(s), still over the ` +
                    `${round(maxBytes)} limit`
            );
        }

        log.warn?.(
            `[video] came out ${round(result.size)} against a ${round(target)} target — ` +
                `correcting ${Math.round(bitrate / 1000)}kbps → ${Math.round(corrected / 1000)}kbps`
        );

        bitrate = corrected;
    }

    // Unreachable: the loop returns on every path. Kept so a future edit that
    // changes the loop cannot fall through to undefined.
    return unchanged(
        last ? `re-encoded to ${round(last.size)}, still over the ${round(maxBytes)} limit` : "the re-encode did not run"
    );
}

module.exports = { fitVideoToLimit, correctedBitrate, resolveBinaries, HEIGHT_FLOORS };
