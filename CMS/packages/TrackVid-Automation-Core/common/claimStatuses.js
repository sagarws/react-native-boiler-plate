/**
 * The claim statuses each platform actually uses, in the order the admin panel
 * shows them.
 *
 * ONE source for the whole federation. The desktop app was showing a single
 * flat list on every platform tab — AJIO's nine — so Myntra rows sat in states
 * the app could not name (`Awaiting Seller Response`, `Awaiting Agent
 * Response`, `Paid`, all written by the status-sync job) while Snapdeal grew
 * four tabs that platform never emits. The same row read differently depending
 * on which screen you opened it in, which is the one thing a status must never
 * do.
 *
 * Mirrors TrackVid-FE `src/pages/CMS.tsx` exactly, including the dot colours,
 * so the two panels cannot drift apart on a redeploy of either.
 *
 * ADDING A PLATFORM is one entry in EXTRA_TABS — never an `if (isFoo)` at a
 * call site. That is what this file exists to replace.
 */

/** Every status the CMS collection can hold. Values are the stored strings. */
const { platformKey } = require("./platforms.js");

const CMS_STATUS = {
    PENDING: "Pending",
    IN_REVIEW: "In Review",
    UN_ATTENDED: "Un Attended",
    IN_PROGRESS: "In Progress",
    CUSTOMER_REPLIED: "Customer Replied",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    RESOLVED: "Resolved",
    // Terminal auto-claim state, written by the BE when processCount exceeds
    // MAX_AUTO_CLAIM_ATTEMPTS. These rows are NOT re-fed to a worker — an
    // operator has to intervene.
    FAILED_TO_PROCEED: "Failed to Proceed",
    // Myntra only, written by the claim status-sync job. Their SPF lifecycle is
    //   OPEN → AWAITING_SELLER_RESPONSE → ACCEPT/REJECT
    //        → AWAITING_AGENT_RESPONSE → PAYMENT_COMPLETED
    AWAITING_SELLER_RESPONSE: "Awaiting Seller Response",
    AWAITING_AGENT_RESPONSE: "Awaiting Agent Response",
    PAID: "Paid",
    // Nykaa only. Its disputes run on Zoho Desk, whose ticket states are these
    // and are written through by the status sync rather than folded into
    // "In Review" — a ticket ON HOLD and one nobody has opened are different
    // things to chase, and CLOSED is not a decision: it says the ticket is
    // finished, not that the claim was paid.
    OPEN: "Open",
    ON_HOLD: "On Hold",
    CLOSED: "Closed",
};

const tab = (value, dot) => ({ value, label: value, dot });

/**
 * The tabs every platform shows, in order. Anything platform-specific is
 * spliced into one of the two gaps below.
 */
const BASE_HEAD = [
    { value: "All", label: "All", dot: "#0088A3" },
    // Sits directly after "All" on every platform so ops always find "rows the
    // worker gave up on" in the same slot.
    tab(CMS_STATUS.FAILED_TO_PROCEED, "#B91C1C"),
    tab(CMS_STATUS.PENDING, "#F59E0B"),
    tab(CMS_STATUS.IN_REVIEW, "#0EA5E9"),
];

/**
 * Per-platform additions, at the two points in the lifecycle they belong.
 *
 *   beforeApproved  states a claim passes through on the way to a decision
 *   afterApproved   states that follow acceptance
 *   afterRejected   terminal states past rejection
 */
const EXTRA_TABS = {
    // AJIO exposes the full workflow its seller portal supports.
    ajio: {
        beforeApproved: [
            tab(CMS_STATUS.UN_ATTENDED, "#A855F7"),
            tab(CMS_STATUS.IN_PROGRESS, "#2563EB"),
            tab(CMS_STATUS.CUSTOMER_REPLIED, "#14B8A6"),
        ],
        afterRejected: [tab(CMS_STATUS.RESOLVED, "#84CC16")],
    },
    myntra: {
        beforeApproved: [tab(CMS_STATUS.AWAITING_SELLER_RESPONSE, "#F97316")],
        afterApproved: [
            tab(CMS_STATUS.AWAITING_AGENT_RESPONSE, "#6366F1"),
            tab(CMS_STATUS.PAID, "#059669"),
        ],
    },
    // Zoho Desk's own lifecycle, kept as Nykaa reports it. `In Review` stays in
    // the base head because rows already carry it — every Nykaa claim filed
    // before this was written is in it.
    nykaa: {
        beforeApproved: [
            tab(CMS_STATUS.OPEN, "#38BDF8"),
            tab(CMS_STATUS.IN_PROGRESS, "#2563EB"),
            tab(CMS_STATUS.ON_HOLD, "#A16207"),
            // Zoho's "awaiting response" has always mapped here, so rows are
            // already sitting in it — with no tab to find them under, which is
            // a row that has vanished from every filter on the page.
            tab(CMS_STATUS.AWAITING_SELLER_RESPONSE, "#F97316"),
        ],
        afterRejected: [
            tab(CMS_STATUS.RESOLVED, "#84CC16"),
            tab(CMS_STATUS.CLOSED, "#64748B"),
        ],
    },
};

/**
 * The ordered status tabs for one platform.
 *
 * An unknown platform gets the base five — the same fallback the admin panel
 * uses — rather than an empty list, so a new marketplace is usable before
 * anyone has decided what its lifecycle looks like.
 *
 * @param {string} platform  platform key, any casing
 * @returns {{value: string, label: string, dot: string}[]}
 */
function claimStatusTabs(platform) {
    const extra = EXTRA_TABS[platformKey(platform)] || {};

    return [
        ...BASE_HEAD,
        ...(extra.beforeApproved || []),
        tab(CMS_STATUS.APPROVED, "#22C55E"),
        ...(extra.afterApproved || []),
        tab(CMS_STATUS.REJECTED, "#EF4444"),
        ...(extra.afterRejected || []),
    ];
}

/** Just the status values for a platform, without "All". */
function claimStatusesFor(platform) {
    return claimStatusTabs(platform)
        .filter((t) => t.value !== "All")
        .map((t) => t.value);
}

/** Does this platform ever put a row in this status? */
function isClaimStatusFor(platform, status) {
    return claimStatusesFor(platform).includes(status);
}

module.exports = {
    CMS_STATUS,
    claimStatusTabs,
    claimStatusesFor,
    isClaimStatusFor,
};
