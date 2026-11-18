// -----------------------------------------------------------------------------
// Nykaa — read a filed claim's ticket, and reply on it
// -----------------------------------------------------------------------------
// The dispute portal is a Zoho Desk customer portal; these are the calls its own
// ticket page makes (docs/guide/api-network-records (9).json, 2026-10-30):
//
//   GET  /portal/api/tickets/search?searchStr=<ticketNumber>&from=1&limit=10&type=
//        → data[].id                        the 7-digit number → Zoho's long id
//   GET  /portal/api/tickets/<id>?include=products       the ticket
//   GET  /portal/api/tickets/<id>/conversations?from=1&limit=…
//        → data[] { type: "thread"|"comment", summary, direction, responder, … }
//   GET  /portal/api/tickets/<id>/threads/<threadId>     one thread IN FULL
//        (the list carries only a truncated `summary`)
//   GET  /portal/api/tickets/<id>/attachments
//   POST /portal/api/uploads                               multipart → { id }
//   POST /portal/api/tickets/<id>/comments
//        { content, attachmentIds: [<upload id>…] }        the reply
//
// Every call carries `portalId` and goes through claimApiFlow's httpCall, so it
// is paced, signed (X-ZCSRF-TOKEN on writes) and turns a dead session into the
// same auth error the claim flow raises.
// -----------------------------------------------------------------------------

const fs = require("fs-extra");
const path = require("path");

const { ORIGIN, DEFAULT_PORTAL_ID, httpCall } = require("./claimApiFlow");

/** How many conversation entries are read. The portal pages by 10; a claim rarely has more than a dozen. */
const MAX_CONVERSATIONS = Number(process.env.NYKAA_TICKET_MAX_CONVERSATIONS) || 50;

/**
 * How many threads are read in full. Each is one call, and the paced client
 * spends budget on every one — the rest keep their (truncated) summary.
 */
const MAX_FULL_THREADS = Number(process.env.NYKAA_TICKET_MAX_FULL_THREADS) || 15;

const portal = (ctx) => `portalId=${encodeURIComponent((ctx && ctx.portalId) || DEFAULT_PORTAL_ID)}`;

/** The ticket page's own headers — the portal sends these on every ticket call. */
const ticketHeaders = (ticketId, extra = {}) => ({
    Referer: `${ORIGIN}/portal/en/ticket/${ticketId}`,
    "X-Requested-With": "XMLHttpRequest",
    ...extra,
});

/** A Zoho record id: long and numeric. The ticket NUMBER a claim stores is short. */
const isZohoId = (value) => /^\d{15,}$/.test(String(value || "").trim());

/**
 * Zoho's id for a ticket number — the number is what a claim row stores and
 * what the portal shows; every other call takes the id.
 *
 * Matched on the number exactly: `searchStr` is a text search and can answer
 * with tickets that merely contain it.
 *
 * @returns {Promise<string>} the id
 */
async function resolveTicketId(ctx, ticket) {
    const wanted = String(ticket || "").trim();

    if (!wanted) throw new Error("resolveTicketId: a ticket number is required");
    if (isZohoId(wanted)) return wanted;

    const url =
        `${ORIGIN}/portal/api/tickets/search?${portal(ctx)}` +
        `&searchStr=${encodeURIComponent(wanted)}&from=1&limit=10&type=`;
    const res = await httpCall(ctx, {
        method: "get",
        url,
        headers: { Referer: `${ORIGIN}/portal/en/myarea`, "X-Requested-With": "XMLHttpRequest" },
        step: `Find ticket ${wanted}`,
    });
    const rows = Array.isArray(res.data && res.data.data) ? res.data.data : [];
    const hit = rows.find((row) => String(row && row.ticketNumber).trim() === wanted);

    if (!hit || !hit.id) {
        const err = new Error(`Nykaa has no ticket ${wanted} on this login`);
        err.code = "TICKET_NOT_FOUND";
        throw err;
    }

    return String(hit.id);
}

/**
 * The ticket as its page shows it: the ticket, every conversation (threads read
 * in full, newest first up to MAX_FULL_THREADS), and its attachments.
 *
 * @returns {Promise<{ id: string, ticket: object, conversations: object[], attachments: object[] }>}
 */
async function fetchTicketThread(ctx, ticket) {
    const id = await resolveTicketId(ctx, ticket);

    const detail = await httpCall(ctx, {
        method: "get",
        url: `${ORIGIN}/portal/api/tickets/${id}?${portal(ctx)}&include=products`,
        headers: ticketHeaders(id, { featureFlags: "onholdTicketStatus,multiLayout,lookUp" }),
        step: `Read ticket ${ticket}`,
    });

    const listed = await httpCall(ctx, {
        method: "get",
        url: `${ORIGIN}/portal/api/tickets/${id}/conversations?${portal(ctx)}&from=1&limit=${MAX_CONVERSATIONS}`,
        headers: ticketHeaders(id, { skipPlainTextConversion: "true" }),
        step: `Read conversations of ${ticket}`,
    });
    const entries = Array.isArray(listed.data && listed.data.data) ? listed.data.data : [];

    // The list is newest first. A thread's full text is one call each, so only
    // the newest are expanded; a failure keeps the summary rather than losing
    // the entry — a truncated message beats a missing one.
    let expanded = 0;
    const conversations = [];

    for (const entry of entries) {
        if (entry && entry.type === "thread" && entry.id && expanded < MAX_FULL_THREADS) {
            expanded += 1;
            try {
                const full = await httpCall(ctx, {
                    method: "get",
                    url: `${ORIGIN}/portal/api/tickets/${id}/threads/${entry.id}?${portal(ctx)}`,
                    headers: ticketHeaders(id),
                    step: `Read a thread of ${ticket}`,
                });
                conversations.push({ ...entry, ...(full.data || {}) });
                continue;
            } catch (err) {
                if (err && (err.code === "AUTH_EXPIRED" || err.status === 401)) throw err;
            }
        }
        conversations.push(entry);
    }

    let attachments = [];
    try {
        const res = await httpCall(ctx, {
            method: "get",
            url: `${ORIGIN}/portal/api/tickets/${id}/attachments?${portal(ctx)}`,
            headers: ticketHeaders(id),
            step: `Read attachments of ${ticket}`,
        });
        attachments = Array.isArray(res.data && res.data.data) ? res.data.data : [];
    } catch (err) {
        // The thread is still worth showing without its file list.
        if (err && (err.code === "AUTH_EXPIRED" || err.status === 401)) throw err;
    }

    return { id, ticket: detail.data || {}, conversations, attachments };
}

/**
 * Uploads one file for a reply. Answers the id `replyTicket` lists.
 *
 * The multipart field is `file` (Zoho Desk's upload contract); the recording
 * does not carry the body, so NYKAA_UPLOAD_FIELD can change it.
 */
async function uploadAttachment(ctx, filePath) {
    if (!filePath || !(await fs.pathExists(filePath))) {
        throw new Error(`uploadAttachment: file not found: ${filePath}`);
    }

    // Optional peer — required where it is used, never at module scope.
    const FormData = require("form-data");
    const form = new FormData();

    form.append(process.env.NYKAA_UPLOAD_FIELD || "file", fs.createReadStream(filePath), {
        filename: path.basename(filePath),
    });

    const res = await httpCall(ctx, {
        method: "post",
        url: `${ORIGIN}/portal/api/uploads?${portal(ctx)}`,
        data: form,
        headers: { ...form.getHeaders(), "X-Requested-With": "XMLHttpRequest" },
        step: `Upload ${path.basename(filePath)}`,
    });
    const uploadId = res.data && res.data.id;

    if (!uploadId) throw new Error(`Nykaa did not take ${path.basename(filePath)}: ${JSON.stringify(res.data || "").slice(0, 160)}`);

    return String(uploadId);
}

/**
 * Replies on a ticket — a comment, with uploaded files attached.
 *
 * `ticket` may be the number or the id; the number is resolved once.
 */
async function replyTicket(ctx, { ticket, content = "", attachmentIds = [] }) {
    const id = await resolveTicketId(ctx, ticket);

    const res = await httpCall(ctx, {
        method: "post",
        url: `${ORIGIN}/portal/api/tickets/${id}/comments?${portal(ctx)}`,
        data: { content: String(content), attachmentIds },
        headers: ticketHeaders(id, { "content-type": "application/json;charset=UTF-8", skipPlainTextConversion: "true" }),
        step: `Reply on ticket ${ticket}`,
    });

    if (!res.data || !res.data.id) {
        throw new Error(`Nykaa did not record the reply on ${ticket}: ${JSON.stringify(res.data || "").slice(0, 160)}`);
    }

    return res.data;
}

module.exports = {
    resolveTicketId,
    fetchTicketThread,
    uploadAttachment,
    replyTicket,
    isZohoId,
    MAX_CONVERSATIONS,
    MAX_FULL_THREADS,
};
