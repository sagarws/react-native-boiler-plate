// -----------------------------------------------------------------------------
// Tata CliQ — Early Refund QC claim, called from inside a logged-in page
// -----------------------------------------------------------------------------
// The seller portal's own calls, in the order the portal makes them. Verified
// against services/api-network-records (12).json (2026-09-17).
//
//   1. SLAVE    see ../../common/slaveSync — list, then setSession. Server-side
//               state: everything below carries no slave id and relies on it.
//   2. EXISTS   GET  /faces/jsp/jqAjaxResponse.jsp?flag=globalSearchExist
//                    &globalSearchParam=Rev_AWB&globalSearchText={awb}
//   3. ROW      POST /faces/oms/jqAjaxOmsResponse.jsp?flag=selectSearchFlagER
//                    body {"searchText":"{awb}","selectDD":"revAwb"}
//               → 22 KB of HTML carrying the return, its transaction id, the
//                 forward AWB and whether a CRM ticket already exists
//   4. UPLOAD   POST /oms/jqAjaxOmsResponse.jsp?flag=uploadImgFlag  × 6
//               → "/images/courierInbound/slave_{code}/{transId}/{transId}_{n}.png"
//   5. SUBMIT   POST /oms/jqAjaxOmsResponse.jsp?flag=InwardFlagForER
//                    &hiddenTransId=&qcFailCIRDD=&qcFailSubReasonCIRDD=
//                    &imagesList=&qcFailPackagingVideoUrl=&qcFailUnboxingVideoUrl=
//                    &comment=&qcPass=&qcFail=
//               → "{ticketId}_Sucess"   (the portal's own spelling)
//
// TWO THINGS MAKE THIS UNLIKE FLIPKART AND MYNTRA.
//
// It is HTML, not JSON. Every endpoint answers text/html — this is a JSP app —
// so the claim's own identifiers are read out of markup. They are read from
// element IDS (`removeCIRInward_{transId}`, `commonPopper_{awb}`), which the
// portal generates from the data, rather than from table positions or labels.
// That is the difference between a parse that survives a restyle and one that
// does not.
//
// And the slave pick is session state, not a parameter. See slaveSync.
//
// WHY IN-PAGE (page.evaluate + fetch): sellerzone.tatacliq.com is behind
// Cloudflare — the capture carries a /cdn-cgi/challenge-platform request — and
// the session is cookie- plus server-state-based. Same reason every AJIO call
// in this repo runs in a page.
// -----------------------------------------------------------------------------

const { ORIGIN } = require("../../common/slaveSync");
const { validateQcSelection, IMAGE_SLOTS } = require("../common/qcReasons");

const OMS = "/oms/jqAjaxOmsResponse.jsp";
const FACES_OMS = "/faces/oms/jqAjaxOmsResponse.jsp";
const FACES_JSP = "/faces/jsp/jqAjaxResponse.jsp";

/** The page the portal makes these calls from; sent as the Referer. */
const QC_PAGE = `${ORIGIN}/faces/oms/EarlyRefundQC.jsp`;

/** What the portal's search dropdown sends for a reverse-AWB search. */
const SEARCH_BY_REVERSE_AWB = "revAwb";

/**
 * The submit's own success marker. Misspelled in the portal, and matched
 * literally — "Success" would never match, and a loose match would call a
 * failure a success.
 */
const SUBMIT_OK = "_Sucess";

/** One in-page fetch, with the portal's own headers. */
/**
 * One call to the portal, made from inside the signed-in page.
 *
 * `form: true` sends `application/x-www-form-urlencoded`, which is what the
 * portal's own XHRs send — captured 2026-09-24 on the QC panel:
 *
 *     Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *     searchText=2377760377949&selectDD=revAwb
 *
 * THIS USED TO SEND JSON, and that is why the search found nothing. These
 * endpoints are JSPs reading `request.getParameter("searchText")`, and a JSON
 * body has no parameters in it — so the page came back rendered but EMPTY, the
 * row parser found no row, and every Tata CliQ claim reported "no claim found
 * for this AWB" on a return that was sitting in the panel.
 *
 * It answered 200 either way, which is what made it survive: nothing in the
 * response said the request had been ignored.
 */
async function portalFetch(page, { url, method = "GET", body = null, form = false }) {
    return page.evaluate(
        async (target, verb, payload, asForm, referer) => {
            const headers = { Accept: "*/*", "X-Requested-With": "XMLHttpRequest", Referer: referer };

            let encoded = payload;

            if (asForm && payload && typeof payload === "object") {
                headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
                encoded = Object.entries(payload)
                    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v ?? ""))}`)
                    .join("&");
            }

            const res = await fetch(target, {
                method: verb,
                credentials: "include",
                headers,
                ...(encoded === null ? {} : { body: encoded }),
            });

            return { status: res.status, ok: res.ok, text: await res.text() };
        },
        url,
        method,
        body,
        form,
        QC_PAGE
    );
}

/**
 * Does this reverse AWB exist at all?
 *
 * The portal asks this before the row, and it is kept for the same reason: a
 * typo'd AWB should cost one cheap call, not a 22 KB parse.
 *
 * ⚠️ UNVERIFIED SIGNAL. In the capture this answered 200 with an EMPTY body for
 * an AWB that does exist, so there is nothing here to tell present from absent
 * — which means a `false` cannot be trusted and is not returned. Until a
 * not-found capture exists, this reports only whether the call itself worked,
 * and `findReturn` is what actually decides. Do not turn this into a gate.
 */
async function globalSearchExists(page, reverseAwb) {
    const url =
        `${ORIGIN}${FACES_JSP}?flag=globalSearchExist&globalSearchParam=Rev_AWB` +
        `&globalSearchText=${encodeURIComponent(reverseAwb)}`;
    const res = await portalFetch(page, { url });

    return { ok: res.ok, body: res.text.trim() };
}

const stripTags = (value) =>
    String(value ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/**
 * Read the return out of the eligibility HTML.
 *
 * FROM IDS, NOT COLUMNS. The portal stamps the data into element ids, and those
 * are what this reads:
 *
 *   removeCIRInward_{transId}     the transaction id — what the submit takes
 *   Inward_{transId}              the QC Fail button
 *   qcPassCIR_{transId}           the QC Pass button
 *   commonPopper_{awb} + class FWD / REV   the two AWBs, labelled
 *
 * Column order would be the obvious way to read the rest, and is the way that
 * breaks when the portal adds a column. The product name and invoice are taken
 * positionally because they have no id — so they are best-effort, and nothing
 * load-bearing depends on them.
 *
 * @returns {{
 *   found: boolean, transId: string|null, forwardAwb: string|null,
 *   reverseAwb: string|null, crmTicket: string|null, claimable: boolean,
 *   productName: string|null, invoiceNumber: string|null
 * }}
 */
function parseReturnRow(html) {
    const source = String(html || "");
    const empty = {
        found: false,
        transId: null,
        forwardAwb: null,
        reverseAwb: null,
        crmTicket: null,
        claimable: false,
        productName: null,
        invoiceNumber: null,
    };

    const transId = (source.match(/\bid="removeCIRInward_(\d+)"/) || [, null])[1];

    if (!transId) return empty;

    // `FWD` / `REV` on the anchor's class is the portal's own labelling of the
    // two AWBs; the value is repeated in the id, which is what is read.
    const awbOf = (kind) => {
        const re = new RegExp(`class="[^"]*\\b${kind}\\b[^"]*"[^>]*\\bid="commonPopper_([^"]+)"`, "i");
        const byClassFirst = source.match(re);

        if (byClassFirst) return byClassFirst[1];

        // The attribute order is not guaranteed; try id-then-class as well
        // before giving up, rather than reporting a missing AWB.
        const alt = new RegExp(`\\bid="commonPopper_([^"]+)"[^>]*class="[^"]*\\b${kind}\\b`, "i");

        return (source.match(alt) || [, null])[1];
    };

    // THE DATA ROW ONLY. The fragment opens with a header row whose <li> cells
    // carry the same classes as the data's — so a parse over the whole fragment
    // reads "CRM Ticket Number" as the ticket and "Product Name" as the
    // product. The data row is the one carrying the AWB anchors.
    const rows = [...source.matchAll(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi)].map((m) => m[1]);
    const row = rows.find((candidate) => candidate.includes("commonPopper_")) || "";

    // A ticket in the row means this return has already been claimed. The
    // portal leaves the cell empty otherwise — the same guard as AJIO's
    // "Ticket No" column, and free in this response.
    const crmCell = row.match(
        /<li class="width-1 revawbbuttton[\s\S]*?<\/li>\s*<li class="width-1">([\s\S]*?)<\/li>/
    );
    const crmTicket = crmCell ? stripTags(crmCell[1]) || null : null;

    const productName = (row.match(/<li class="width-2 light-blue">([\s\S]*?)<\/li>/) || [, ""])[1];

    // The invoice sits between the forward and reverse AWB cells.
    const invoice = row.match(
        /class="[^"]*\bFWD\b[\s\S]*?<\/li>\s*<li class="width-1">([\s\S]*?)<\/li>/
    );

    return {
        found: true,
        transId,
        forwardAwb: awbOf("FWD"),
        reverseAwb: awbOf("REV"),
        crmTicket,
        // The buttons are the portal's own answer to "can this be claimed":
        // a row it will not accept a QC decision for renders without them.
        claimable: source.includes(`id="Inward_${transId}"`),
        productName: stripTags(productName) || null,
        invoiceNumber: invoice ? stripTags(invoice[1]) || null : null,
    };
}

/**
 * Find a return by its reverse AWB, under whichever slave the session is set to.
 *
 * Returns the parsed row and the raw HTML — the caller keeps the HTML because a
 * row that did not parse is a report worth the markup, and because the QC
 * sub-reason list for a reason is in there.
 */
async function findReturn(page, reverseAwb, { selectDD = SEARCH_BY_REVERSE_AWB } = {}) {
    if (!reverseAwb) throw new Error("findReturn: a reverse AWB is required");

    const res = await portalFetch(page, {
        url: `${ORIGIN}${FACES_OMS}?flag=selectSearchFlagER&submodel=null`,
        method: "POST",
        // Form-encoded, as the portal's own XHR sends it. See portalFetch.
        form: true,
        body: { searchText: String(reverseAwb), selectDD },
    });

    if (!res.ok) throw new Error(`selectSearchFlagER failed: HTTP ${res.status}`);

    return { ...parseReturnRow(res.text), html: res.text };
}

/**
 * The multipart field one proof image goes in: `imgFile_{transId}_{slot}`.
 *
 * READ FROM THE PORTAL'S OWN CODE (QC Panel, 2026-10-30), not inferred. The
 * Submit handler uploads each image with
 *
 *   startCsvUpload_(url, "imgFile_"+i, "imgFile_"+i, …, "imgFile_"+tranx+"_"+i)
 *
 * and startCsvUpload_ does `data.append(_fullTrnx, file)` — the LAST argument.
 * The transaction and the slot are carried in the FIELD NAME; that is how the
 * stored path comes back as `{transId}/{transId}_{n}.png`. Posting under the
 * modal input's own name (`imgFile_{n}`) leaves the portal no transaction and
 * it answers "Problem occured while uploading Images".
 *
 * TATACLIQ_UPLOAD_FIELD (with `{transId}` and `{slot}` placeholders) overrides
 * it, for the day the portal changes.
 */
const imageField = (transId, slot) =>
    (process.env.TATACLIQ_UPLOAD_FIELD || "imgFile_{transId}_{slot}")
        .replace("{transId}", String(transId))
        .replace("{slot}", String(slot));

/**
 * Upload one proof image, and return the name the submit must list.
 *
 * Built in the page from base64 rather than fetched there: the images live in
 * TrackVid's S3 and the portal's origin cannot read them (CORS), so the bytes
 * come from the caller. Same shape as AJIO's `uploadClaimAttachment`.
 *
 * Content-Type is deliberately NOT set — the browser writes the multipart
 * boundary, and setting the header by hand produces a body the portal cannot
 * parse.
 *
 * The response is the stored path:
 *   /images/courierInbound/slave_{code}/{transId}/{transId}_{n}.png
 * and `imagesList` on the submit wants only the file name, so that is what
 * comes back.
 *
 * @param {object} page
 * @param {object} input
 * @param {string} input.transId
 * @param {number} input.slot      1-6, see IMAGE_SLOTS — positional, per the portal
 * @param {string} input.base64    the image bytes
 * @param {string} input.fileName  what to call it in the form
 * @param {string} [input.mimeType]
 * @returns {Promise<{ fileName: string, path: string }>}
 */
async function uploadProofImage(page, { transId, slot, base64, fileName, mimeType = "image/png" }) {
    if (!transId) throw new Error("uploadProofImage: transId is required");
    if (!slot || slot < 1 || slot > IMAGE_SLOTS.length) {
        throw new Error(`uploadProofImage: slot must be 1-${IMAGE_SLOTS.length}, got ${slot}`);
    }
    if (!base64) throw new Error("uploadProofImage: the image bytes are required");

    const url = `${ORIGIN}${OMS}?flag=uploadImgFlag`;
    const res = await page.evaluate(
        async (target, field, b64, name, type, referer) => {
            try {
                const bin = atob(b64);
                const bytes = new Uint8Array(bin.length);

                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

                const form = new FormData();

                form.append(field, new Blob([bytes], { type }), name);

                const r = await fetch(target, {
                    method: "POST",
                    credentials: "include",
                    headers: { Accept: "*/*", "X-Requested-With": "XMLHttpRequest", Referer: referer },
                    body: form,
                });

                return { status: r.status, ok: r.ok, text: (await r.text()).slice(0, 2000) };
            } catch (err) {
                return { status: -1, ok: false, text: String(err) };
            }
        },
        url,
        imageField(transId, slot),
        base64,
        fileName || `${transId}_${slot}.png`,
        mimeType,
        QC_PAGE
    );

    const path = String(res.text || "").trim();

    if (!res.ok || !path) {
        throw new Error(`uploadImgFlag failed for slot ${slot}: HTTP ${res.status} ${path.slice(0, 160)}`);
    }

    // A path is the portal's success. Anything else — an error page, an empty
    // body — must not be passed to the submit as though a file had landed:
    // `imagesList` naming files that do not exist is a claim that looks filed
    // and has nothing for a reviewer to open.
    if (!path.startsWith("/images/")) {
        throw new Error(`uploadImgFlag answered something that is not a stored path: ${path.slice(0, 160)}`);
    }

    return { fileName: path.split("/").pop(), path };
}

/**
 * Submit the QC failure — the call that raises the claim.
 *
 * Everything is a query parameter, including the images and the videos; the
 * portal sends no body. `qcFail` repeats `qcFailCIRDD` because the portal
 * sends both.
 *
 * @param {object} page
 * @param {object} input
 * @param {string} input.transId      from `parseReturnRow`
 * @param {string} input.reason       a QC_REASONS code
 * @param {string} [input.subReason]  required for the reasons that take one
 * @param {string[]} [input.imagesList]  the upload responses' file names
 * @param {string} [input.packagingVideoUrl]
 * @param {string} [input.unboxingVideoUrl]
 * @param {string} [input.comment]    max 200 chars, per the portal's input
 * @returns {Promise<{ ok: boolean, ticketId: string|null, raw: string }>}
 */
async function submitQcFail(page, input) {
    const transId = String(input?.transId || "").trim();

    if (!transId) throw new Error("submitQcFail: transId is required");

    const selection = validateQcSelection(input.reason, input.subReason);

    if (!selection.ok) throw Object.assign(new Error(selection.message), { code: "QC_SELECTION_INVALID" });

    const params = new URLSearchParams({
        flag: "InwardFlagForER",
        hiddenTransId: transId,
        qcFailCIRDD: selection.reason,
        // Empty for the six reasons that take none — the portal's own page
        // clears the select, so an inherited value must not travel.
        qcFailSubReasonCIRDD: selection.subReason || "",
        imagesList: (input.imagesList || []).join(","),
        qcFailPackagingVideoUrl: input.packagingVideoUrl || "",
        qcFailUnboxingVideoUrl: input.unboxingVideoUrl || "",
        comment: String(input.comment || "").slice(0, 200),
        qcPass: "",
        qcFail: selection.reason,
    });

    const res = await portalFetch(page, {
        url: `${ORIGIN}${OMS}?${params.toString()}`,
        method: "POST",
    });

    const raw = res.text.trim();

    if (!res.ok) throw new Error(`InwardFlagForER failed: HTTP ${res.status} ${raw.slice(0, 120)}`);

    // "487554_Sucess" — the ticket id, then the portal's own spelling.
    const ticketId = raw.endsWith(SUBMIT_OK) ? raw.slice(0, -SUBMIT_OK.length).trim() || null : null;

    return { ok: !!ticketId, ticketId, raw };
}

/** How many images the submit expects, and which of them the modal stars. */
const REQUIRED_IMAGE_SLOTS = IMAGE_SLOTS.filter((slot) => slot.required).length;

module.exports = {
    ORIGIN,
    QC_PAGE,
    SEARCH_BY_REVERSE_AWB,
    REQUIRED_IMAGE_SLOTS,
    globalSearchExists,
    parseReturnRow,
    findReturn,
    uploadProofImage,
    submitQcFail,
};
