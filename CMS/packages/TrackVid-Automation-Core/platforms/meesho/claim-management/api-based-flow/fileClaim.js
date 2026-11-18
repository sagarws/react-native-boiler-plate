// -----------------------------------------------------------------------------
// Meesho — file one CMS claim over the supplier-panel APIs
// -----------------------------------------------------------------------------
// The per-AWB sequence, shared by every runner:
//
//   Automated-Scripts  src/platforms/meesho/.../apiScriptNew.js   (server)
//   Trackvid-CMS       electron/main/automations/platforms/meesho (desktop)
//
// Both need the identical sequence — dedupe on sub_order_number, upload every
// asset, create the ticket, read the ticket id back. Only the orchestration
// around it differs, so that stays in the consumers.
//
// Injected because the two consumers disagree:
//   saveResource   the server mirrors downloaded assets into its report share;
//                  the desktop app has no share. Omit it and nothing is mirrored.
//   perClaimFiles  the caller's cleanup list, appended as temp files appear.
//   log            defaults to console.
//
// Nothing here touches Mongo, so a consumer without the driver can run it.
// -----------------------------------------------------------------------------

const path = require("path");
const { assertClaimSubmitEnabled } = require("../../../../common/claimSubmitGuard");
const { meeshoId } = require("../../common/identifiers.js");
const {
    MEESHO_INVALID_AWB,
    MEESHO_ALREADY_RAISED_NO_TICKET,
} = require("../../../../common/claimErrors.js");

const {
    uploadAttachment,
    createTicket,
    searchTicketsBySubOrder,
    searchReturnClaims,
    extractTicketId,
    extractTicketStatus,
    claimStatusToCmsStatus,
    resolveSubCategoryIdLive,
    rtoSubCategoryFor,
    isOpaqueServerError,
} = require("./claimApiFlow.js");
const { uploadLimitFor } = require("../../../../common/uploadLimits.js");

/**
 * Meesho's cap on one attachment, in bytes.
 *
 * Read from common/uploadLimits, which owns it: the desktop app's "Download
 * Resource" offers the operator a copy sized for the same limit, and two
 * definitions of one marketplace's cap is how the runner and the download come
 * to disagree about what will upload.
 */
const MAX_UPLOAD_BYTES = uploadLimitFor("meesho");

/**
 * How long to keep asking whether the ticket appeared, after a submit that
 * answered 500.
 *
 * Three reads over about eleven seconds. Meesho's ticket list did not show a
 * ticket one second after such a failure on a claim that HAD been filed, and
 * the cost of being wrong in the other direction is a duplicate dispute on the
 * same return — so the wait is worth it, and it only ever happens on a claim
 * that has already failed.
 */
const VERIFY_DELAYS_MS = [0, 3_000, 8_000];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Files the ticket, and on an opaque 500 asks Meesho whether it was filed
 * anyway.
 *
 * Returns what `createTicket` returns, or — when the 500 turned out to be a
 * lost response over a real ticket — `{ recovered: true, ticketId, … }`.
 *
 * ONLY FOR THE 500 THAT SAYS NOTHING. A refusal Meesho explains (a closed
 * window, an unknown sub-order, a rejected field) is a claim that was never
 * created, and polling for it would add eleven seconds to every one of them
 * for an answer already known.
 */
async function createTicketWithVerification(ctx, sub, log, payload) {
    try {
        return await createTicket(ctx, payload);
    } catch (err) {
        if (!sub || !isOpaqueServerError(err)) throw err;

        log.warn?.(
            `   ⚠️ ${err.message} — asking Meesho whether the ticket was created anyway`
        );

        const recovered = await recoverTicket((wanted) => searchTicketsBySubOrder(ctx, wanted), sub, { log });

        // Nothing there after every read: the ticket really was not created,
        // and the row is safe to retry.
        if (!recovered) throw err;

        return { recovered: true, ...recovered };
    }
}

/**
 * Meesho says a ticket already exists — go and find it, or say ME5.
 *
 * THE ID IS NOT IN MEESHO'S SENTENCE. Its API sends the template unrendered —
 * `Ticket {{ticket_id}} has already been raised for this issue.` — so there is
 * nothing to parse out of it and the ticket has to be searched for. (The
 * script flow sees a real number there, because the portal interpolates it.)
 *
 * BOTH NUMBERS ARE TRIED. The pre-flight dedupe already searched by the row's
 * sub-order before filing; if Meesho's own differs, that difference is the
 * likeliest reason the first search came back empty — and the corrected number
 * is the one its ticket is filed under.
 *
 * WHEN NOTHING IS FOUND it ends in ME5 rather than the original refusal.
 * Meesho is certain a ticket exists and no search can produce it: two facts
 * that cannot both be acted on. Reporting the refusal reads as a plain failure
 * and invites a retry — and retrying is exactly how the ticket Meesho will not
 * show becomes two tickets for one return.
 *
 * MODULE-LEVEL, not a closure inside the flow, so the decision that stands
 * between "record the ticket" and "raise a duplicate" can be tested without a
 * browser and a live seller account.
 *
 * @param {object} input
 * @param {(sub: string) => Promise<unknown[]>} input.search
 * @param {(string|null)[]} input.candidates sub-order numbers to look under
 * @returns {Promise<object>} the claim result carrying the ticket
 * @throws when no ticket can be found — code MEESHO_ALREADY_RAISED_NO_TICKET
 */
async function recordExistingMeeshoTicket({
    search, candidates, sub, correctedSubOrder = null, filedAwb, log = console,
    // Injectable for the same reason `search` is: the waits are what make this
    // correct against a search index that lags, and a test should be able to
    // exercise the DECISION without living through them.
    delays = VERIFY_DELAYS_MS,
}) {
    // Deduped and emptied: the two numbers are often the same, and searching
    // the same one twice asks a question already answered.
    const wanted = (candidates || []).filter(
        (value, index, all) => value && all.indexOf(value) === index
    );

    for (const candidate of wanted) {
        const found = await recoverTicket(search, candidate, { log, delays });

        if (!found) continue;

        log.log?.(
            `   ✅ Meesho already has ticket ${found.ticketId} for sub ${candidate} ` +
                `(${found.meeshoStatus} → ${found.cmsStatus}) — recording it`
        );

        return {
            ticketId: found.ticketId,
            alreadyExisted: true,
            cmsStatus: found.cmsStatus,
            meeshoStatus: found.meeshoStatus,
            subOrderNumber: candidate,
            // The corrected number is reported whenever the ticket was found
            // under one the row did not hold — that is what stops the next run
            // repeating the search that failed.
            correctedSubOrder: candidate !== sub ? candidate : correctedSubOrder,
            awbNumber: filedAwb,
        };
    }

    log.warn?.(
        `   ⚠️ Meesho says a ticket already exists for ${wanted.join(" / ") || "this return"}, ` +
            "but none could be found to record"
    );

    const unfindable = new Error(MEESHO_ALREADY_RAISED_NO_TICKET);

    unfindable.code = "MEESHO_ALREADY_RAISED_NO_TICKET";
    unfindable.detail = `searched ${wanted.join(", ") || "(no sub-order number)"}`;

    throw unfindable;
}

/**
 * Asks, repeatedly, whether a ticket exists for this sub-order.
 *
 * The search is passed IN so this can be exercised without a portal: what is
 * worth pinning is the waiting and the giving up, not Meesho's endpoint.
 *
 * @param {(subOrderNumber: string) => Promise<unknown[]>} search
 * @param {string} sub
 * @param {object} [options]
 * @param {number[]} [options.delays] milliseconds before each read
 * @returns {Promise<{ticketId: string, meeshoStatus: string|null, cmsStatus: string|null}|null>}
 */
async function recoverTicket(search, sub, { delays = VERIFY_DELAYS_MS, log = console } = {}) {
    for (const delay of delays) {
        if (delay) await sleep(delay);

        let found = [];

        try {
            found = await search(sub);
        } catch (searchErr) {
            // A failed search is not evidence of anything. Try the next window;
            // if they all fail, the caller's original error is still the truth.
            log.warn?.(`   ⚠️ Ticket check failed: ${searchErr.message}`);

            continue;
        }

        const ticketId = extractTicketId(Array.isArray(found) ? found[0] : null);

        if (!ticketId) continue;

        const meeshoStatus = extractTicketStatus(found[0]);

        return { ticketId, meeshoStatus, cmsStatus: claimStatusToCmsStatus(meeshoStatus) };
    }

    return null;
}

/**
 * Which attachment slots hold video.
 *
 * By slot rather than by file extension: the CMS URL for an unpacking video
 * often carries no extension at all, and a claim's "attachments" can hold
 * either. The video slot is known to be video, which is what matters — an image
 * sent through the encoder would lose quality to no purpose.
 */
const isVideoTag = (tag) => /^video/i.test(String(tag || ""));

/** Meesho pads empty image slots with a URL ending in "undefined". */
function isPlaceholderUrl(url) {
    if (typeof url !== "string") return true;
    const trimmed = url.trim();
    if (!trimmed) return true;
    const last = trimmed.split("?")[0].split("/").filter(Boolean).pop() || "";
    return /^(undefined|null)$/i.test(last) || /^(undefined|null)$/i.test(trimmed);
}

/**
 * What an attachment is called when Meesho receives it.
 *
 * Its own function because it is a RULE, not a string: every identifier Meesho
 * is sent goes through `meeshoId` — upper-cased, and corrected to Meesho's own
 * spelling when the return was found under another — and this was the last
 * place the raw value leaked through. A claim reached the portal as
 * "r2485756038fp_video_….mp4": the row's AWB in the wrong case, on a ticket
 * carrying it in the right one.
 *
 * Falls back to the value as given when it is not a string Meesho would accept,
 * because a badly-named attachment is still better than no evidence.
 */
function attachmentName(awbNumber, tag) {
    return `${meeshoId(awbNumber) || awbNumber}_${tag}`;
}

async function downloadToFile(url, filename, tempDir) {
    if (!url || !url.startsWith("http")) return null;
    const axios = require("axios");
    const fs = require("fs-extra");
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    const ext = path.extname(new URL(url).pathname) || ".tmp";
    const filePath = path.join(tempDir, `${filename}_${Date.now()}${ext}`);
    await fs.writeFile(filePath, res.data);
    return filePath;
}

/**
 * Download a CMS URL, upload it to Meesho, return the GCS URL.
 *
 * Returns null when the url is missing or a placeholder; throws UPLOAD_FAILED
 * when a real URL fails, because silently dropping evidence produces a ticket
 * the reviewer will reject for missing proof.
 */
async function downloadAndUpload(ctx, url, tag, awbNumber, tempDir, options = {}) {
    const { perClaimFiles = [], saveResource = null, saveCtx = {}, log = console } = options;

    if (!url || isPlaceholderUrl(url)) return null;

    let local;
    // Normalised here too, not only at the call — see `attachmentName`.
    const named = meeshoId(awbNumber) || awbNumber;

    try {
        local = await downloadToFile(url, attachmentName(awbNumber, tag), tempDir);
    } catch (err) {
        throw new Error(`UPLOAD_FAILED: ${tag} — download failed: ${err.message}`);
    }
    if (!local) throw new Error(`UPLOAD_FAILED: ${tag} — download returned no file`);
    perClaimFiles.push(local);

    if (saveResource) {
        await saveResource({
            srcPath: local,
            companyId: saveCtx.companyId,
            companyName: saveCtx.companyName,
            // The archived copy is keyed by AWB, so it is the SAME spelling
            // the ticket and the upload carry — otherwise one claim's evidence
            // sits under two names on this machine.
            awbNumber: named,
            filename: path.basename(local),
        });
    }

    // Meesho refuses anything over 25MB with a bare HTTP 400, and a phone shoots
    // past that in under a minute — so the unpacking video, the most persuasive
    // thing a claim carries, is the attachment most likely to be refused.
    //
    // Shrunk only if it is actually over, and only ever the video: the images
    // are nowhere near the cap, and re-encoding one would cost quality for
    // nothing. The ORIGINAL is what `saveResource` above has already mirrored —
    // the archive keeps full quality, and only the copy Meesho receives is cut
    // down to what Meesho will take.
    let toUpload = local;

    if (isVideoTag(tag)) {
        const { fitVideoToLimit } = require("../../../../common/videoCompress.js");
        const fitted = await fitVideoToLimit(local, {
            maxBytes: MAX_UPLOAD_BYTES,
            tempDir,
            logger: log,
        }).catch((err) => ({ path: local, compressed: false, reason: err.message }));

        if (fitted.compressed) {
            perClaimFiles.push(fitted.path);
            toUpload = fitted.path;
        } else if (fitted.reason) {
            // Not fatal here. The upload below reports the size refusal in the
            // marketplace's own words, which is the more useful half; this line
            // says why nothing could be done about it.
            log.warn?.(`   ⚠️ ${tag} could not be shrunk — ${fitted.reason}`);
        }
    }

    try {
        return await uploadAttachment(ctx, toUpload);
    } catch (err) {
        throw new Error(`UPLOAD_FAILED: ${tag} — ${err.message}`);
    }
}

/** Upload a field that may hold one URL or several, dropping the empty slots. */
async function uploadList(ctx, raw, tag, awbNumber, tempDir, options) {
    const sources = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const urls = [];

    for (let i = 0; i < sources.length; i++) {
        const uploaded = await downloadAndUpload(ctx, sources[i], `${tag}_${i + 1}`, awbNumber, tempDir, options);
        if (uploaded) urls.push(uploaded);
    }

    return urls;
}

/**
 * One CMS row → one filed Meesho ticket.
 *
 * Returns { ticketId, alreadyExisted, cmsStatus, meeshoStatus }.
 * Throws with .code=AUTH_EXPIRED when the session died, so the caller can
 * re-login once and retry.
 */
async function fileMeeshoClaim(ctx, configEntry, awbNumber, tempDir, credentials, options = {}) {
    const { log = console } = options;

    // Step 1 — is this return on the account we are signed in as?
    //
    // The Returns search IS the account: the session scopes it. Asked before
    // anything is downloaded or uploaded, because a claim for someone else's
    // parcel is the one mistake that cannot be taken back. A search that
    // FAILS is not a verdict and does not stop the claim — only an answer that
    // names this return under a different account's would, and there is no such
    // answer: the search is scoped, so "not found" is what that looks like.
    //
    // Asked by AWB and then, if that finds nothing, by SUB-ORDER NUMBER. A row
    // whose AWB has gone stale — a re-booked return carries a new waybill, a
    // scanned row can carry the forward leg's — used to fail here as "wrong awb
    // number", which sent somebody looking for a mistake that was not theirs.
    let accountReturn = null;
    let matchedBy = null;
    try {
        const search = await searchReturnClaims(ctx, awbNumber, {
            subOrderNumber: configEntry.subOrderNumber || null,
            logger: log,
        });
        accountReturn = search.found ? search.returns[0] : null;
        matchedBy = search.matchedBy;
        if (!search.found) {
            // The MESSAGE is what an operator reads in the Script Error column,
            // so it is the code and nothing else. The TAG that the flow itself
            // keys on moves to `.code`, where it belongs — the account and the
            // queries that were tried go to `.detail` and the log, which have
            // room for them.
            const notFound = new Error(MEESHO_INVALID_AWB);

            notFound.code = "NO_RETURN_PACKETS";
            notFound.detail =
                `not on ${credentials.username || "this account"}` +
                (search.tried && search.tried.length > 1
                    ? ` — searched by ${search.tried.join(" and ")}`
                    : "");

            throw notFound;
        }
    } catch (err) {
        // Its own failure (a dead session, a gateway hiccup) must not be read
        // as "this AWB is not on the account". Matched on the code rather than
        // on the message, which no longer carries the tag.
        if (err && err.code === "NO_RETURN_PACKETS") throw err;
        if (err && err.code === "AUTH_EXPIRED") throw err;
        log.warn(`   ⚠️ Global AWB search failed for ${awbNumber}: ${err.message}`);
    }

    // Meesho keys the ticket on the sub-order number, and the search knows it.
    // A CMS row that never had one can still be filed.
    //
    // Upper-cased here as well as at each call, so the value LOGGED and the
    // value handed back to the caller are the value Meesho was actually sent.
    let sub =
        meeshoId(configEntry.subOrderNumber) ||
        meeshoId(accountReturn && accountReturn.subOrderNumber) ||
        null;

    /**
     * Set when Meesho refused the row's number and its own was used instead.
     *
     * Reported back so the caller can write the corrected number onto the row:
     * without that, every future run repeats the same rejected first attempt.
     */
    let correctedSubOrder = null;

    if (sub && sub !== meeshoId(configEntry.subOrderNumber)) {
        log.log(`   ℹ️ Sub-order number read from Meesho: ${sub}`);
    }

    // THE AWB MEESHO IS HOLDING, which is the one the ticket must carry.
    //
    // Taken from the search response rather than from the CMS row, because when
    // the two disagree Meesho is right by definition: it is the party that
    // issued the waybill and the party that will read the ticket. Filing the
    // stale number produces a ticket whose AWB matches nothing in their system —
    // accepted at submit, then rejected by a reviewer days later, which is the
    // expensive way to find out.
    //
    // Only ever taken when the search actually answered. A failed search leaves
    // the row's own AWB alone rather than blanking it.
    const filedAwb = meeshoId(accountReturn && accountReturn.awb) || meeshoId(awbNumber);

    // Compared on the normalised forms, so a row that differs from Meesho only
    // in case is not announced as a correction — it is the same waybill.
    if (accountReturn && filedAwb && filedAwb !== meeshoId(awbNumber)) {
        log.log(
            `   ℹ️ AWB corrected from Meesho: ${awbNumber} → ${filedAwb}` +
                (matchedBy ? ` (matched by ${matchedBy})` : "")
        );
    }

    // Step 1b — dedupe by sub_order_number. Meesho accepts a second ticket for
    // the same suborder, so without this a re-run files a duplicate.
    let existing = [];
    if (sub) {
        try { existing = await searchTicketsBySubOrder(ctx, sub); }
        catch (err) { log.warn(`   ⚠️ Existing-ticket check failed: ${err.message}`); }
    }
    if (existing.length > 0) {
        const hit = existing[0];
        const ticketId = extractTicketId(hit);
        if (ticketId) {
            const meeshoStatus = extractTicketStatus(hit);
            const cmsStatus = claimStatusToCmsStatus(meeshoStatus);
            log.log(`ℹ️ Prior ticket for sub ${sub} → ${ticketId} (${meeshoStatus} → ${cmsStatus})`);
            return {
                ticketId,
                alreadyExisted: true,
                cmsStatus,
                meeshoStatus,
                subOrderNumber: sub,
                awbNumber: filedAwb,
            };
        }
    }

    // Step 2 — upload every asset. Barcode, product images, reverse waybill,
    // and video all go through the same upload endpoint but into different
    // ticket_details slots (see claimApiFlow.createTicket).
    //
    // NAMED WITH `filedAwb`, not the AWB as it arrived. Every identifier Meesho
    // is sent goes through `meeshoId` — upper-cased, and corrected to Meesho's
    // own spelling when the return was found under a different one — and the
    // upload was the last place the raw value still leaked through. It reached
    // the portal as "r2485756038fp_video_….mp4", which is the row's AWB in the
    // wrong case attached to a ticket that carries it in the right one.
    const barcodeImageUrl = await downloadAndUpload(
        ctx, configEntry.barcodeImage, "barcode", filedAwb, tempDir, options
    );
    const productImageUrls = await uploadList(ctx, configEntry.productImage, "product", filedAwb, tempDir, options);
    const reverseWaybillUrls = await uploadList(ctx, configEntry.reverseWaybill, "waybill", filedAwb, tempDir, options);
    const videoUrl = await downloadAndUpload(
        ctx, configEntry.unpackingVideo, "video", filedAwb, tempDir, options
    );
    // Extra attachments (miscellaneous — a separate ticket_details field).
    const attachmentUrls = await uploadList(ctx, configEntry.attachments, "attach", filedAwb, tempDir, options);

    if (!barcodeImageUrl && productImageUrls.length === 0 && reverseWaybillUrls.length === 0 && !videoUrl) {
        throw new Error("EVIDENCE_MISSING: no attachable images/video for this claim.");
    }

    // Step 3 — resolve sub_category_id from the typeOfClaim vocabulary. Asked
    // of Meesho, with the static table as the fallback: the id decides which
    // form the ticket is filed on, and filing a damaged-return claim on the
    // wrong form is a claim the reviewer rejects.
    //
    // AN RTO IS FILED ON ITS OWN FORM. The Returns search above says whether
    // this parcel is a customer return (RET) or a return-to-origin (RTO), and
    // form 1 refuses every RTO with "only if your return order has been
    // delivered" — see MEESHO_RTO_SUBCATEGORIES.
    const shipmentType = (accountReturn && accountReturn.type) || null;
    // `let`: an RTO refusal at submit moves the claim to the RTO form — see
    // `submitTicket` below.
    let subCategoryId = await resolveSubCategoryIdLive(ctx, configEntry.typeOfClaim, { shipmentType });

    if (shipmentType) log.log(`   ℹ️ ${filedAwb} is ${shipmentType} — filing on form ${subCategoryId}`);

    // Step 4 — file the ticket. The one irreversible call.
    assertClaimSubmitEnabled("Meesho", "create ticket");

    /**
     * THE SUBMIT MAY LAND AND STILL ANSWER 500.
     *
     * Meesho's gateway answers a claim it cannot process with a bare 500 and
     * `{"backendData":{"error":""}}` — no field, no message. The handler inside
     * `createTicket` asks whether that means a closed window or an unknown
     * sub-order, and when it is neither the 500 is thrown as itself.
     *
     * But "neither" includes the case where the ticket WAS created and only the
     * response was lost, and reporting that as a failure is how a second ticket
     * gets raised for the same return: the operator sees Failed and files
     * again. So Meesho is asked what exists before the failure is allowed to
     * stand.
     *
     * POLLED, NOT ASKED ONCE. The ticket list did not show a ticket a second
     * after the failed submit — verified from a run where the claim really had
     * been filed — so an immediate single read is the one read most likely to
     * miss it.
     */
    let submitted;

    /**
     * The ticket payload, with whichever sub-order number we are trying.
     *
     * Built as a function because it is built twice: once with the row's
     * number, and — if Meesho rejects that — once with Meesho's own. Every
     * other field is identical, and a second literal is how the two copies
     * drift.
     */
    const ticketPayload = (subOrderNumber) => ({
        subCategoryId, categoryId: "1",
        supplierEmail: credentials.username,
        subOrderNumber,
        // Meesho's own number, not the row's — see `filedAwb`. The uploads
        // above deliberately stay keyed on the CMS AWB: those filenames are how
        // an operator finds the evidence again on our side, and renaming them
        // to a number the row does not carry would hide it.
        awbNumber: filedAwb,
        stateOfPacket: configEntry.stateOfPacket,
        packetId: configEntry.packetId,
        barcodeImageUrl, productImageUrls, reverseWaybillUrls, videoUrl,
        description: configEntry.description || "",
        attachments: attachmentUrls,
        callbackNumber: configEntry.callbackNumber,
    });

    /**
     * "THIS IS AN RTO SHIPMENT" — refiled on the RTO form, once.
     *
     * The form is chosen above from the Returns search's `type`, and that is
     * the cheap way to get it right. But a search that did not find the return,
     * or found it without a type, left an RTO on form 1 — and Meesho refused
     * it naming the form it wanted, on claims an operator then filed by hand on
     * that exact form (139). The refusal IS the type, from the party that
     * decides, so it is acted on rather than reported.
     *
     * ONCE, and only to a form this claim type actually has. A type with no RTO
     * form (damaged, missing) has nothing to move to, so Meesho's refusal stands
     * as it always did. Errors from the refile propagate to the same handlers
     * the first attempt has (already raised, invalid sub-order).
     */
    let rtoRefiled = false;
    const submitTicket = async (subOrderNumber) => {
        try {
            return await createTicketWithVerification(ctx, subOrderNumber, log, ticketPayload(subOrderNumber));
        } catch (err) {
            const rtoForm = rtoSubCategoryFor(configEntry.typeOfClaim);

            if (err?.code !== "MEESHO_RTO_SHIPMENT" || rtoRefiled || !rtoForm || rtoForm.id === String(subCategoryId)) {
                throw err;
            }

            rtoRefiled = true;
            log.warn?.(
                `   ⚠️ Meesho says ${filedAwb} is an RTO — refiling on form ${rtoForm.id} ` +
                    `("${rtoForm.title}") instead of form ${subCategoryId}`
            );
            subCategoryId = rtoForm.id;

            return await createTicketWithVerification(ctx, subOrderNumber, log, ticketPayload(subOrderNumber));
        }
    };

    /** Meesho says a ticket exists — find it, or end in ME5. See the function. */
    const recordExistingTicket = () =>
        recordExistingMeeshoTicket({
            search: (wanted) => searchTicketsBySubOrder(ctx, wanted),
            candidates: [sub, meeshoId(accountReturn && accountReturn.subOrderNumber)],
            sub,
            correctedSubOrder,
            filedAwb,
            log,
        });

    try {
        submitted = await submitTicket(sub);
    } catch (err) {
        /**
         * "Please enter a valid sub order number" — and Meesho already told us
         * the right one.
         *
         * THE ROW'S NUMBER WINS when both exist (see `sub` above), which is
         * right most of the time: it is what the operator entered. But a row
         * imported with a stale or mistyped sub-order sends a number Meesho
         * does not know, and the claim died there — on a return the search had
         * ALREADY located, whose real sub-order number was sitting in the same
         * response that found it.
         *
         * So the refusal is answered with that number rather than reported.
         *
         * ONCE, AND ONLY WHEN IT DIFFERS. A second attempt with the same value
         * asks a question already answered; and if Meesho refuses its own
         * number there is nothing further to try, so the second failure is the
         * one that stands.
         */
        /**
         * MEESHO ALREADY HAS A TICKET FOR THIS RETURN.
         *
         * Step 1b above asks this before filing — but it asks by the SUB-ORDER
         * NUMBER, so a row carrying a stale one finds nothing, files, and is
         * told at submit what the search could not see. Reported as a failure
         * the row sat on Failed to Proceed with a live ticket nobody tracked,
         * and every retry asked again.
         *
         * The id is not in Meesho's sentence — its API sends the template
         * unrendered, `{{ticket_id}}` — so it is SEARCHED for, with the same
         * poll the post-500 recovery uses: the ticket may have been created a
         * moment ago and not be in the index yet.
         *
         * Both numbers are tried. The row's is what the first search used; if
         * Meesho's own differs, that is the one its ticket is filed under, and
         * it is the reason the first search came back empty.
         */
        if (err?.code === "MEESHO_ALREADY_RAISED") return await recordExistingTicket();

        const meeshoSub = meeshoId(accountReturn && accountReturn.subOrderNumber);

        if (err?.code !== "INVALID_SUB_ORDER" || !meeshoSub || meeshoSub === sub) throw err;

        log.warn?.(
            `   ⚠️ Meesho does not recognise sub-order ${sub || "(none)"} — refiling with the one ` +
                `its own search returned: ${meeshoSub}`
        );

        /*
         * THE REFILE NEEDS ITS OWN CATCH, and this is where the first version
         * of this leaked.
         *
         * An error thrown from INSIDE a catch block is not caught by that
         * block. So when the corrected number was answered with "already been
         * raised" — which is exactly what a stale sub-order number implies: the
         * claim was filed once under the right one — it sailed past the
         * recovery above and out of the flow, and the row reported a failure
         * over a ticket that exists.
         *
         * The number is committed BEFORE the call so a recovery inside it
         * searches under the number actually filed with.
         */
        sub = meeshoSub;
        correctedSubOrder = meeshoSub;

        try {
            submitted = await submitTicket(meeshoSub);
        } catch (refileErr) {
            if (refileErr?.code !== "MEESHO_ALREADY_RAISED") throw refileErr;

            return await recordExistingTicket();
        }
    }

    // Filed a moment ago, or found on Meesho after a 500 that lost its
    // response — either way it exists, and the readback below reports it.
    if (submitted && submitted.recovered) {
        log.log(
            `   ✅ Ticket ${submitted.ticketId} already existed on Meesho for sub ${sub} — ` +
            "the 500 lost the response, not the ticket"
        );

        return {
            ticketId: submitted.ticketId,
            alreadyExisted: true,
            cmsStatus: submitted.cmsStatus,
            meeshoStatus: submitted.meeshoStatus,
            subOrderNumber: sub,
            // Set only when Meesho refused the row's number and its own was used
            // instead. The caller writes it back, so the next run does not repeat
            // the rejected first attempt.
            correctedSubOrder,
            awbNumber: filedAwb,
        };
    }

    log.log(`   ✅ Ticket submitted for ${filedAwb} (sub ${sub})`);

    // Step 5 — the ticket id. createTicket returns it on success (verified
    // 2026-09-16), and the ticket list is the fallback for a build that does
    // not.
    let ticketId = submitted && submitted.ticketId ? submitted.ticketId : null;
    if (!ticketId && sub) {
        try {
            const list = await searchTicketsBySubOrder(ctx, sub);
            ticketId = extractTicketId(list[0]);
        } catch (err) { log.warn(`   ⚠️ Readback failed: ${err.message}`); }
    }
    if (!ticketId) {
        const err = new Error("Ticket id not captured after submit; verify manually.");
        err.code = "TICKET_READBACK_FAILED";
        throw err;
    }
    // `awbNumber` and `subOrderNumber` come back so a consumer can write the
    // corrected values onto the claim. Additive: a caller that ignores them
    // behaves exactly as it did before.
    return {
        ticketId,
        alreadyExisted: false,
        cmsStatus: null,
        meeshoStatus: null,
        subOrderNumber: sub,
        // Set only when Meesho refused the row's number and its own was used
        // instead. The caller writes it back, so the next run does not repeat
        // the rejected first attempt.
        correctedSubOrder,
        awbNumber: filedAwb,
    };
}

module.exports = {
    recoverTicket,
    recordExistingMeeshoTicket,
    VERIFY_DELAYS_MS,
    fileMeeshoClaim,
    downloadAndUpload,
    isPlaceholderUrl,
    downloadToFile,
    attachmentName,
};
