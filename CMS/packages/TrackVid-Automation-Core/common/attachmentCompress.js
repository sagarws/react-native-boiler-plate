// -----------------------------------------------------------------------------
// Fit any attachment under a marketplace's size cap
// -----------------------------------------------------------------------------
// The companion to videoCompress.js, and the reason it exists: Meesho caps at
// 25MB, where only the unpacking video is ever close, so shrinking video alone
// was enough. Snapdeal caps at 5MB — and a phone photo clears that on its own,
// before anybody films anything. So the cap now has to be applied to every
// attachment, not just the one that used to be the obvious offender.
//
// ONE ENTRY POINT, dispatching on what the file actually is:
//
//   video   delegated to fitVideoToLimit, unchanged — the encoder settings
//           there are the accumulated result of real refusals
//   image   re-encoded here, quality first and then scale, until it fits
//   other   left alone, with a reason the caller can show
//
// IT RETURNS THE SAME SHAPE AS fitVideoToLimit — { path, compressed, from, to,
// reason } — so a call site can swap one for the other without learning a
// second contract, and a file it cannot shrink is reported rather than thrown:
// the upload below it already reports the marketplace's own refusal, which is
// the more useful half of the message.
// -----------------------------------------------------------------------------

const path = require("path");

const { fitVideoToLimit, resolveBinaries } = require("./videoCompress.js");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".3gp"]);

/**
 * JPEG quality steps, worst case last.
 *
 * Quality BEFORE scale, deliberately. A claim is argued from what the reviewer
 * can see in the photo — a torn seal, a wrong SKU — and detail survives a
 * quality drop far better than it survives being made physically smaller. Only
 * when 2 cannot fit does the image start losing pixels.
 */
const QUALITY_STEPS = [4, 7, 12, 20, 28];

/** Scale factors tried once quality alone has failed. */
const SCALE_STEPS = [0.75, 0.5, 0.35, 0.25];

const run = (file, args, timeoutMs = 2 * 60 * 1000) =>
    new Promise((resolve, reject) => {
        const { spawn } = require("child_process");
        const child = spawn(file, args, { windowsHide: true });
        let stderr = "";
        const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* already gone */ }
            reject(new Error(`${path.basename(file)} timed out`));
        }, timeoutMs);

        child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
        child.on("error", (err) => { clearTimeout(timer); reject(err); });
        child.on("close", (code) => {
            clearTimeout(timer);

            if (code === 0) resolve();
            else reject(new Error(stderr.trim().split("\n").pop() || `exited ${code}`));
        });
    });

function kindOf(file) {
    const ext = path.extname(file).toLowerCase();

    if (VIDEO_EXTENSIONS.has(ext)) return "video";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";

    return ext.replace(".", "") || "file";
}

/**
 * Re-encode an image until it fits, or give up saying why.
 *
 * ALWAYS TO JPEG, whatever came in. A 9MB PNG of a photograph is 9MB because
 * PNG is lossless, and no quality setting will help while it stays one; the
 * same picture as JPEG is a few hundred KB. The marketplace shows the reviewer
 * a picture either way.
 *
 * EACH ATTEMPT STARTS FROM THE ORIGINAL, never from the previous output —
 * re-encoding an already-lossy result compounds the artefacts, and the second
 * pass would be noticeably worse than one pass at the same final setting.
 */
async function fitImageToLimit(input, { maxBytes, tempDir, logger } = {}) {
    const fs = require("fs-extra");
    const log = logger || console;
    const original = (await fs.stat(input)).size;
    const unchanged = (reason) => ({ path: input, compressed: false, from: original, to: original, reason });

    if (original <= maxBytes) return unchanged(null);

    const { ffmpeg } = resolveBinaries();

    if (!ffmpeg) return unchanged("ffmpeg is not available on this machine");

    /*
     * A DIRECTORY OF ITS OWN, and the winner keeps the ORIGINAL STEM.
     *
     * Snapdeal derives the stored attachment's name — the slot the reviewer
     * sees — from the uploaded filename, which is why the download step takes
     * such care to produce `POD_slip_image1`. A shrunk copy called
     * `POD_slip_image1.page.fit2.jpg` would undo that at the last step.
     *
     * The sub-directory is what makes keeping the stem safe: `x.jpg` shrunk to
     * `x.jpg` in the same folder would overwrite the original, which the
     * archive mirror and the caller's cleanup list both still point at.
     */
    const stem = path.basename(input, path.extname(input));
    const dir = path.join(tempDir || path.dirname(input), "fit");

    await fs.ensureDir(dir);

    // Quality alone first, then quality paired with a smaller frame. The pairs
    // are generated rather than nested in two loops so the order of attempts is
    // readable in one place: this is the escalation, worst last.
    const attempts = [
        ...QUALITY_STEPS.map((quality) => ({ quality, scale: 1 })),
        ...SCALE_STEPS.flatMap((scale) => QUALITY_STEPS.slice(2).map((quality) => ({ quality, scale }))),
    ];

    let best = null;

    for (const [index, { quality, scale }] of attempts.entries()) {
        const out = path.join(dir, `${stem}.try${index}.jpg`);
        const filters = ["scale=trunc(iw*SCALE/2)*2:-2".replace("SCALE", String(scale))];

        try {
            await run(ffmpeg, [
                "-y",
                "-i", input,
                ...(scale === 1 ? [] : ["-vf", filters[0]]),
                // A single still, not a sequence. Without these ffmpeg warns
                // that the filename holds no `%03d` pattern — and on some
                // builds it refuses outright rather than warning.
                "-frames:v", "1",
                "-update", "1",
                // JPEG quality: 2 is near-lossless, 31 is the floor. Lower is
                // better, which is the opposite of every other scale here.
                "-q:v", String(quality),
                out,
            ]);
        } catch (err) {
            log.warn?.(`   ⚠️ image re-encode failed (q${quality} ×${scale}): ${err.message}`);
            continue;
        }

        const size = (await fs.stat(out).catch(() => null))?.size ?? Infinity;

        if (size <= maxBytes) {
            const named = path.join(dir, `${stem}.jpg`);

            await fs.move(out, named, { overwrite: true });

            log.info?.(
                `   🗜️ ${path.basename(input)} ${(original / 1e6).toFixed(1)}MB → ` +
                `${(size / 1e6).toFixed(1)}MB (q${quality}${scale === 1 ? "" : ` ×${scale}`})`
            );

            return { path: named, compressed: true, from: original, to: size, reason: null };
        }

        // Kept only while it is the smallest so far, so a failed fit does not
        // leave a dozen rejects beside the original.
        if (!best || size < best.size) {
            if (best) await fs.remove(best.path).catch(() => {});
            best = { path: out, size };
        } else {
            await fs.remove(out).catch(() => {});
        }
    }

    if (best) await fs.remove(best.path).catch(() => {});

    return unchanged(
        `could not get it under ${(maxBytes / 1e6).toFixed(0)}MB — smallest was ` +
        `${best ? (best.size / 1e6).toFixed(1) : "?"}MB`
    );
}


/**
 * Pull the largest embedded raster image out of a PDF.
 *
 * WHY THIS IS ENOUGH, for the PDFs that actually turn up here. A courier's
 * proof-of-delivery is a SCAN: the file is one photograph with a thin PDF
 * wrapper, and the photograph is already a JPEG — PDF stores those verbatim
 * under `/DCTDecode`, byte for byte. So the picture can be lifted out with a
 * read, no decoder and no new dependency, and then shrunk by the image path
 * that already exists.
 *
 * IT IS ALSO THE RIGHT FILE TO SEND. Snapdeal's slot is `POD_slip_image` — an
 * image slot. The PDF was never what the reviewer wanted; it is what the
 * courier happened to produce.
 *
 * A PDF THIS DOES NOT FIT returns null and says so: a text-born PDF has no
 * photograph in it, and a `/FlateDecode` image is a raw bitmap that would need
 * decoding and re-encoding to be worth anything. Null is honest, and the caller
 * still offers the original so the marketplace gives its own verdict.
 *
 * Parsed by scanning rather than with a PDF library, deliberately: what is
 * needed is "find the JPEGs", not "understand the document", and every library
 * that understands the document is a native binary or a megabyte of parser.
 */
function extractJpegFromPdf(buffer) {
    // Every JPEG begins FF D8 FF and ends FF D9. Inside a PDF those bytes sit
    // between `stream` and `endstream`, under a dictionary naming DCTDecode.
    const SOI = Buffer.from([0xff, 0xd8, 0xff]);
    const EOI = Buffer.from([0xff, 0xd9]);

    let best = null;
    let from = 0;

    for (;;) {
        const start = buffer.indexOf(SOI, from);

        if (start === -1) break;

        const end = buffer.indexOf(EOI, start + 3);

        if (end === -1) break;

        const candidate = buffer.subarray(start, end + 2);

        from = end + 2;

        // The dictionary sits just before the stream. Checked over a window
        // rather than parsed: a thumbnail and a scan are both JPEGs, and only
        // the size tells them apart anyway.
        const header = buffer.subarray(Math.max(0, start - 512), start).toString("latin1");

        if (!header.includes("DCTDecode")) continue;
        if (!best || candidate.length > best.length) best = candidate;
    }

    return best;
}

/**
 * Fit a PDF under the cap by sending the picture inside it instead.
 *
 * Returns the usual shape. The replacement is a `.jpg`, which is what the
 * marketplace's image slot wanted in the first place.
 */
async function fitPdfToLimit(input, { maxBytes, tempDir, logger } = {}) {
    const fs = require("fs-extra");
    const log = logger || console;
    const original = (await fs.stat(input)).size;
    const unchanged = (reason) => ({ path: input, compressed: false, from: original, to: original, reason });

    if (original <= maxBytes) return unchanged(null);

    const jpeg = extractJpegFromPdf(await fs.readFile(input));

    if (!jpeg) {
        return unchanged(
            `PDF holds no embedded photograph to send instead — ` +
            `${(original / 1e6).toFixed(1)}MB against a ${(maxBytes / 1e6).toFixed(0)}MB cap`
        );
    }

    // The same reasoning as the image path: the stem is the marketplace's slot
    // name, so the file that goes up is `<stem>.jpg` and nothing else.
    const stem = path.basename(input, path.extname(input));
    const dir = path.join(tempDir || path.dirname(input), "fit");

    await fs.ensureDir(dir);

    const extracted = path.join(dir, `${stem}.jpg`);

    await fs.writeFile(extracted, jpeg);

    log.info?.(
        `   📄 ${path.basename(input)} → the scan inside it ` +
        `(${(original / 1e6).toFixed(1)}MB → ${(jpeg.length / 1e6).toFixed(1)}MB)`
    );

    // Often already under the cap once the PDF wrapper is gone; shrunk further
    // only if it is not.
    if (jpeg.length <= maxBytes) {
        return { path: extracted, compressed: true, from: original, to: jpeg.length, reason: null };
    }

    // Still over: shrink the extracted scan, one directory deeper so its own
    // `<stem>.jpg` cannot collide with the one just written here.
    const fitted = await fitImageToLimit(extracted, { maxBytes, tempDir: dir, logger });

    await fs.remove(extracted).catch(() => {});

    if (!fitted.compressed) return unchanged(fitted.reason);

    return { ...fitted, from: original };
}

/**
 * Fit one attachment under a cap, whatever kind of file it is.
 *
 * @param {string} input          the file on disk
 * @param {object} options
 * @param {number} options.maxBytes the marketplace's cap. Falsy means "no known
 *        cap", and the file is left alone — see uploadLimits.js: absent means
 *        unknown, never unlimited.
 * @returns {Promise<{path: string, compressed: boolean, from: number, to: number, reason: string|null}>}
 */
async function fitAttachmentToLimit(input, { maxBytes, tempDir, logger } = {}) {
    const fs = require("fs-extra");

    if (!maxBytes || maxBytes <= 0) {
        const size = (await fs.stat(input)).size;

        return { path: input, compressed: false, from: size, to: size, reason: null };
    }

    const kind = kindOf(input);

    if (kind === "video") return fitVideoToLimit(input, { maxBytes, tempDir, logger });
    if (kind === "image") return fitImageToLimit(input, { maxBytes, tempDir, logger });
    if (kind === "pdf") return fitPdfToLimit(input, { maxBytes, tempDir, logger });

    const size = (await fs.stat(input)).size;

    if (size <= maxBytes) {
        return { path: input, compressed: false, from: size, to: size, reason: null };
    }

    /*
     * A PDF, most often — a courier's proof-of-delivery slip comes back as one.
     *
     * NOT SHRUNK, and said plainly rather than attempted badly. Every tool that
     * genuinely re-compresses a PDF is a separate binary (ghostscript, qpdf) and
     * neither runner ships one; re-wrapping it in JavaScript moves the bytes
     * around without removing any. The message names the file and the cap so the
     * operator can replace it with a photo, which is what actually fixes it.
     */
    return {
        path: input,
        compressed: false,
        from: size,
        to: size,
        reason:
            `${kind.toUpperCase()} attachments cannot be shrunk here — ` +
            `${(size / 1e6).toFixed(1)}MB against a ${(maxBytes / 1e6).toFixed(0)}MB cap`,
    };
}

module.exports = {
    fitAttachmentToLimit,
    fitImageToLimit,
    fitPdfToLimit,
    extractJpegFromPdf,
    kindOf,
    QUALITY_STEPS,
    SCALE_STEPS,
};
