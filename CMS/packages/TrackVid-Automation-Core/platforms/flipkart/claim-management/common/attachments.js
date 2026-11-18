// -----------------------------------------------------------------------------
// Flipkart — what its claim upload will take, and what can never work
// -----------------------------------------------------------------------------
// Flipkart validates an upload by its FILENAME EXTENSION, independently of the
// content type it sniffs. Verified from a rejection it sent us:
//
//   {"type":"FILE_TYPE_VALIDATION","errors":{"extensionValid":false,
//    "contentTypeValid":true,"fileName":"shipping-label","contentType":"image/png",
//    "allowedExtensions":[".jpg",".bmp",".jpeg",".png"]}}
//
// — a real PNG, rejected purely because the filename carried no extension.
//
// SO THERE IS NO WAY TO ATTACH A VIDEO. The allowed list is four image
// extensions; the portal's own claim form offers nothing else. A CMS row whose
// evidence includes an .mp4 is not a row that needs a bigger timeout or a
// retry — it is a row with a file Flipkart will not accept under any
// circumstances.
//
// What it actually did with one, three attempts running:
//
//   UPLOAD_FAILED: video — Attachment upload failed
//   (r2485756038fpl_video_1789741986434.mp4): HTTP 503
//   <TITLE>Internal Server Error</TITLE> … Internal Server Error - Write
//
// A 503 from the write, not a validation message — a video is large, and the
// upload gateway gave up on the body before anything looked at its name. So it
// did not even fail in a way that explained itself.
//
// Hence this: the evidence list is partitioned BEFORE anything is downloaded or
// uploaded. Images go to Flipkart; a video is reported by name and left behind,
// and the claim is filed with the proof that can actually be attached. Losing
// the dispute over an unattachable file is the worse outcome — and the operator
// gets a line naming the file rather than a 503.
// -----------------------------------------------------------------------------

const path = require("path");

/** What the upload endpoint accepts. Flipkart's own list, from the rejection above. */
const ALLOWED_UPLOAD_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp"];

/**
 * Extensions a Flipkart claim can NEVER carry — video, audio, documents.
 *
 * A DENY LIST, deliberately, and not the inverse of the allow list above. An
 * S3 key with no extension at all is a perfectly ordinary image here, and
 * "everything not on the allow list" would silently drop it — filing a claim
 * with less proof than the operator attached, which is how a dispute is lost
 * quietly. Only what is KNOWN to be unattachable is left behind; anything else
 * still goes to the uploader, which fails loudly by name if Flipkart refuses.
 */
const UNATTACHABLE_EXTENSIONS = [
    ".mp4",
    ".mov",
    ".m4v",
    ".avi",
    ".mkv",
    ".webm",
    ".wmv",
    ".flv",
    ".3gp",
    ".mpeg",
    ".mpg",
    ".mp3",
    ".wav",
    ".m4a",
    ".pdf",
    ".zip",
];

/** The extension of a URL's last path segment, lowercased. "" when there is none. */
function extensionOf(url) {
    try {
        return path.extname(new URL(String(url)).pathname).toLowerCase();
    } catch (_) {
        // Not a URL — a bare key or a local path. Same question, same answer.
        return path.extname(String(url || "").split("?")[0]).toLowerCase();
    }
}

/** Can this file never be attached to a Flipkart claim? */
function isUnattachable(url) {
    return UNATTACHABLE_EXTENSIONS.includes(extensionOf(url));
}

/**
 * Split a CMS row's evidence into what Flipkart can take and what it cannot.
 *
 * @param {string[]} urls `configEntry.evidenceImages`, in the order given
 * @returns {{ uploadable: string[], rejected: {url: string, ext: string}[] }}
 *   `rejected` is for the caller to REPORT — by name, in the run's log and its
 *   result — never to drop in silence. The whole point of separating them here
 *   is that both halves stay visible.
 */
function partitionEvidence(urls) {
    const uploadable = [];
    const rejected = [];

    for (const url of (urls || []).filter(Boolean)) {
        if (isUnattachable(url)) rejected.push({ url, ext: extensionOf(url) });
        else uploadable.push(url);
    }

    return { uploadable, rejected };
}

/**
 * One readable line out of an error body, however the gateway chose to answer.
 *
 * Flipkart's upload endpoint does not always answer JSON. Under load it returns
 * an Apache error PAGE, and dumping 300 characters of it into the claim's error
 * put this in the CMS's Script Error column:
 *
 *   HTTP 503 "<HTML><HEAD>\n<TITLE>Internal Server Error</TITLE>\n</HEAD>
 *   <BODY>\n<H1>Internal Server Error - Write</H1>\nThe server encountered an
 *   internal error or misconfiguration and was unable to…
 *
 * — which an operator has to read like markup to learn one fact: the write
 * failed. The title and the heading ARE that fact, so they are what is kept.
 *
 * @param {*} data an axios response body: object, string, HTML page, anything
 * @param {number} [max] how much of a non-HTML body to keep
 */
function httpBodySummary(data, max = 300) {
    if (data === null || data === undefined) return "";

    const text = typeof data === "string" ? data : JSON.stringify(data);

    if (!text) return "";
    if (!/<html|<title|<h1/i.test(text)) return text.slice(0, max);

    const pick = (tag) => {
        const match = text.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));

        return match ? match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() : "";
    };

    // The <h1> is the specific one ("Internal Server Error - Write"); the
    // <title> is the generic one. Prefer the specific, keep both when they
    // differ, and fall back to the stripped page if the server sent neither.
    const heading = pick("h1");
    const title = pick("title");
    const parts = [heading, title].filter(Boolean);
    const summary = [...new Set(parts)].join(" — ");

    return (summary || text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()).slice(0, max);
}

module.exports = {
    httpBodySummary,
    ALLOWED_UPLOAD_EXTENSIONS,
    UNATTACHABLE_EXTENSIONS,
    extensionOf,
    isUnattachable,
    partitionEvidence,
};
