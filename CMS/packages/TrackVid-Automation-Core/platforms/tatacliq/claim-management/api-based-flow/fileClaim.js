// -----------------------------------------------------------------------------
// Tata CliQ — file one claim, start to finish
// -----------------------------------------------------------------------------
// The per-claim sequence, shared by both runners: Automated-Scripts files from
// the server, Trackvid-CMS from an operator's machine, and both call THIS so a
// Tata CliQ claim is raised one way only.
//
// The orchestration, and why it is in this order:
//
//   1. slave        the return is visible only to the slave that owns it, and
//                   the pick is server-side session state. Set it first or the
//                   search finds nothing and reads like a missing return.
//   2. find         one call returns the transaction id, BOTH AWBs, the invoice
//                   and whether a CRM ticket already exists.
//   3. guard        a row with a CRM ticket is already claimed. Stop — a second
//                   ticket for one return is worse than no ticket.
//   4. upload       the proof images, one call per slot, the slot in the field
//                   name. Done BEFORE the submit because the submit lists what
//                   they returned.
//   5. submit       raises the claim and answers "{ticketId}_Sucess".
//
// NEVER THROWS for a marketplace answer. Every outcome a seller could care
// about comes back as a status the caller maps to its own vocabulary — the same
// contract as fileFlipkartClaim and fileMyntraClaim, so the runners' reporting
// code is identical across platforms. Only a broken page or a bug throws.
// -----------------------------------------------------------------------------

const axios = require("axios");

const { findReturn, uploadProofImage, submitQcFail } = require("./claimApiFlow");
const { findSlave, setSlaveSession } = require("../../common/slaveSync");
const { probeSessionInPage } = require("../../common/sessionStore");
const {
    IMAGE_SLOTS,
    needsSubReason,
    needsVideo,
    validateQcSelection,
    qcReasonLabel,
} = require("../common/qcReasons");

/**
 * The claim window has closed.
 *
 * The QC Panel stops listing a return once its window ends, so the portal says
 * nothing about time: its search just answers "No Search Found". That is what
 * this means once the return has been looked for under the claim's slave, or
 * under every slave the login has, on a session proven to be alive.
 *
 * An INFERENCE, unlike Meesho's and Flipkart's, whose portals say so in words.
 * The text is plain "TAT Expired" as asked for, so it is not one of the
 * prefixed codes in common/claimErrors. Which slaves were searched goes to the
 * log, so the row keeps one filterable string.
 */
const TAT_EXPIRED_MESSAGE = "TAT Expired";

/** How long one proof image is given to download. */
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.TATACLIQ_IMAGE_TIMEOUT_MS) || 60000;

/**
 * Put the claim's images into the portal's six slots.
 *
 * THE SLOT IS THE MEANING. Slot 1 is the product image, slot 4 the packing slip
 * — the portal numbers them and a reviewer reads them by number, so an image in
 * the wrong slot is a claim arguing the wrong thing. The caller supplies them
 * keyed by slot (`{ productImage, productCode, brandMarking, packingSlip,
 * additional1, additional2 }`), which is what lets an operator rearrange them
 * upstream without this needing to know.
 *
 * THREE SHAPES ACCEPTED, because two callers supply different things and
 * neither should have to convert for the other: a plain URL string, `{ url }`,
 * or `{ base64, fileName, mimeType }` for a caller that already holds the
 * bytes. TrackVid-BE's claim config hands back URLs — the same way it does for
 * every other platform — so that is the normal path.
 *
 * @returns {{ ready: Array, missingRequired: string[] }}
 */
function planUploads(images = {}) {
    const ready = [];
    const missingRequired = [];

    for (const slot of IMAGE_SLOTS) {
        const supplied = images[slot.key];
        const url = typeof supplied === "string" ? supplied : supplied?.url;
        const base64 = typeof supplied === "object" ? supplied?.base64 : null;

        if (base64 || url) {
            ready.push({ ...slot, url: url || null, base64: base64 || null, ...(typeof supplied === "object" ? supplied : {}) });
        } else if (slot.required) {
            missingRequired.push(slot.label);
        }
    }

    return { ready, missingRequired };
}

/**
 * The bytes for one slot.
 *
 * Fetched HERE rather than by the caller, so both runners behave identically —
 * the same reason AJIO's flow downloads its own attachment. A URL that cannot
 * be read is a hard failure: the alternative is a claim submitted listing an
 * image the portal never received.
 */
async function imageBytes(image) {
    if (image.base64) {
        return {
            base64: image.base64,
            fileName: image.fileName || `${image.key}.png`,
            mimeType: image.mimeType || "image/png",
        };
    }

    const res = await axios.get(image.url, {
        responseType: "arraybuffer",
        timeout: IMAGE_FETCH_TIMEOUT_MS,
    });

    return {
        base64: Buffer.from(res.data).toString("base64"),
        // The stored name where there is one — a reviewer downloading the file
        // gets something recognisable rather than "blob".
        fileName: image.fileName || decodeURIComponent(String(image.url).split("/").pop() || `${image.key}.png`),
        mimeType: image.mimeType || res.headers?.["content-type"] || "image/png",
    };
}

/**
 * File one Tata CliQ claim.
 *
 * @param {object} page a logged-in page — see common/login + common/sessionStore
 * @param {object} input
 * @param {string} input.reverseAwb    the return AWB to claim against
 * @param {object} [input.slave]       `{ id, name }` when the caller has already
 *        resolved it. Otherwise pass `slaves`, with `slaveName` to pick one or
 *        without it to have them swept.
 * @param {Array}  [input.slaves]      the credential's stored slaves
 * @param {string} [input.slaveName]   which of them this return belongs to
 * @param {string} input.reason        a QC_REASONS code
 * @param {string} [input.subReason]   only Wrong Product takes one
 * @param {object} [input.images]      slot key → { base64, fileName, mimeType }
 * @param {string} [input.packagingVideoUrl]
 * @param {string} [input.unboxingVideoUrl]
 * @param {string} [input.comment]
 * @param {boolean} [input.allowIncompleteImages=false] file even though a
 *        required slot is empty. Off by default: the portal accepts it and a
 *        human rejects it days later.

 * @param {object} [options]
 * @param {object} [options.logger]
 * @returns {Promise<{
 *   status: 'success'|'already_claimed'|'not_found'|'not_claimable'|'failed',
 *   ticketId: string|null, transId: string|null, forwardAwb: string|null,
 *   message: string
 * }>}
 */
async function fileTataCliqClaim(page, input, { logger } = {}) {
    const log = logger || console;
    const reverseAwb = String(input?.reverseAwb || "").trim();
    const fail = (message, extra = {}) => ({
        status: "failed",
        ticketId: null,
        transId: null,
        forwardAwb: null,
        message,
        ...extra,
    });

    if (!reverseAwb) return fail("No return AWB to claim against");

    // ---- 1. which slave owns this return -----------------------------------
    // An explicit name is honoured or REFUSED — never quietly replaced. A
    // typo'd name falling back to "the only slave" is how a claim gets filed
    // against a warehouse nobody chose, and it succeeds, which is why it would
    // go unnoticed.
    const named = String(input.slaveName || "").trim();
    const candidates = input.slave
        ? [input.slave]
        : named
          ? [findSlave(input.slaves || [], named)].filter(Boolean)
          : // NO NAME: SWEEP. Tata CliQ has no master data to say which
            // warehouse a return belongs to, and the portal will not answer
            // without one being selected — so each is tried until one owns the
            // return, exactly as AJIO's account mapping tries POBs. The caller
            // hands them most-recently-useful first (see the desktop's
            // `slavesOf`), and claims arrive in batches from one warehouse, so
            // this is usually one search rather than several.
            (input.slaves || []);

    if (candidates.length === 0) {
        return fail(
            named
                ? `No slave named "${named}" on this Tata CliQ login — run Sync slaves, or check the name`
                : "This Tata CliQ login has no slaves stored — run Sync slaves for it first"
        );
    }

    // ---- 2. the QC selection ----------------------------------------------
    // Checked before a single call. The reason decides what the claim even
    // needs, so getting it wrong late means uploads spent on a claim that
    // cannot be submitted.
    const selection = validateQcSelection(input.reason, input.subReason);

    if (!selection.ok) return fail(selection.message);

    // ---- 3. find the return ------------------------------------------------
    let row = null;
    let slave = null;
    const searched = [];

    for (const candidate of candidates) {
        try {
            // `false` is an HTTP refusal. Searching on would ask the PREVIOUS
            // slave, and its miss would read as this slave's.
            if ((await setSlaveSession(page, candidate)) === false) {
                return fail(`Could not switch to slave ${candidate.name}: the portal refused`);
            }
        } catch (err) {
            return fail(`Could not switch to slave ${candidate.name}: ${err.message}`);
        }

        let found;

        try {
            found = await findReturn(page, reverseAwb);
        } catch (err) {
            return fail(`Tata CliQ search failed for ${reverseAwb}: ${err.message}`);
        }

        searched.push(candidate.name);

        if (found.found) {
            row = found;
            slave = candidate;
            break;
        }
    }

    if (!row || !slave) {
        // PROVE THE SESSION FIRST. A signed-out page answers the search with a
        // 200 and no row, the same as "No Search Found", and TAT Expired stops
        // the row being retried. A dead session must stay a retryable failure.
        const { alive } = await probeSessionInPage(page);

        if (!alive) return fail(`The Tata CliQ session stopped working while searching for ${reverseAwb}`);

        // The list goes to the log, not the message: the row's text is matched
        // by the claims filter, so it has to be one string.
        log.warn?.(
            `⌛ [tatacliq] ${reverseAwb}: No Search Found on ` +
            (searched.length === 1 ? `slave ${searched[0]}` : `any of ${searched.length} slaves (${searched.join(", ")})`)
        );

        return {
            status: "not_found",
            ticketId: null,
            transId: null,
            forwardAwb: null,
            message: TAT_EXPIRED_MESSAGE,
        };
    }

    if (searched.length > 1) {
        log.info?.(`🔎 [tatacliq] ${reverseAwb} found on slave ${slave.name} (searched ${searched.length})`);
    }

    const found = { transId: row.transId, forwardAwb: row.forwardAwb };

    // The portal's own already-claimed guard, free in the search response.
    if (row.crmTicket) {
        return {
            status: "already_claimed",
            ticketId: row.crmTicket,
            ...found,
            message: `Already claimed — Tata CliQ holds ticket ${row.crmTicket} for ${reverseAwb}`,
        };
    }

    // No QC buttons on the row is the portal saying it will not take a decision
    // for this return. Reported as its own outcome rather than a failure: a
    // retry will not change it.
    if (!row.claimable) {
        return {
            status: "not_claimable",
            ticketId: null,
            ...found,
            message: `Tata CliQ will not accept a QC decision for ${reverseAwb} (no QC Fail on the row)`,
        };
    }

    // ---- 4. the proofs -----------------------------------------------------
    const { ready, missingRequired } = planUploads(input.images);

    if (missingRequired.length > 0 && !input.allowIncompleteImages) {
        return fail(
            `Missing required image${missingRequired.length === 1 ? "" : "s"}: ${missingRequired.join(", ")}`,
            found
        );
    }

    if (needsVideo(selection.reason) && !input.packagingVideoUrl && !input.unboxingVideoUrl) {
        // A warning, not a refusal. The portal accepts the submit, and which of
        // the two videos a reviewer wants varies — but a claim under one of
        // these reasons with no footage at all is one somebody will ask about.
        log.warn?.(
            `⚠️ [tatacliq] ${reverseAwb}: "${qcReasonLabel(selection.reason)}" usually needs a video and none was supplied`
        );
    }

    // The bytes first, all of them: a link that cannot be read must stop the
    // claim before anything is put on the portal.
    const prepared = [];

    for (const image of ready) {
        try {
            prepared.push({ ...image, ...(await imageBytes(image)) });
        } catch (err) {
            return fail(`Could not read "${image.label}" for ${reverseAwb}: ${err.message}`, found);
        }
    }

    const imagesList = [];

    try {
        for (const image of prepared) {
            const uploaded = await uploadProofImage(page, {
                transId: row.transId,
                slot: image.slot,
                base64: image.base64,
                fileName: image.fileName,
                mimeType: image.mimeType,
            });

            imagesList.push(uploaded.fileName);
        }
    } catch (err) {
        // Stop. A partial upload set submitted as complete is a claim whose
        // evidence does not match what it says it has.
        return fail(`Upload failed on ${reverseAwb}: ${err.message}`, found);
    }

    log.info?.(
        `📎 [tatacliq] ${reverseAwb}: ${imagesList.length} image${imagesList.length === 1 ? "" : "s"} uploaded` +
        ` under ${qcReasonLabel(selection.reason)}` +
        (needsSubReason(selection.reason) ? ` / ${selection.subReason}` : "")
    );

    // ---- 5. submit ---------------------------------------------------------
    try {
        const submitted = await submitQcFail(page, {
            transId: row.transId,
            reason: selection.reason,
            subReason: selection.subReason,
            imagesList,
            packagingVideoUrl: input.packagingVideoUrl,
            unboxingVideoUrl: input.unboxingVideoUrl,
            comment: input.comment,
        });

        if (!submitted.ok) {
            // A 200 that is not "{id}_Sucess" means the portal did not raise a
            // ticket. Carrying its own words is the only way to find out why.
            return fail(
                `Tata CliQ did not raise a ticket for ${reverseAwb}: ${submitted.raw.slice(0, 160) || "empty response"}`,
                found
            );
        }

        log.info?.(`🎫 [tatacliq] ${reverseAwb} → ticket ${submitted.ticketId}`);

        return {
            status: "success",
            ticketId: submitted.ticketId,
            ...found,
            message: `Claim raised — ticket ${submitted.ticketId}`,
        };
    } catch (err) {
        return fail(`Tata CliQ submit failed for ${reverseAwb}: ${err.message}`, found);
    }
}

module.exports = { fileTataCliqClaim, planUploads, imageBytes };
