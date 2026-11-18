// -----------------------------------------------------------------------------
// Refill Data — which blanks a marketplace can fill in for an existing claim
// -----------------------------------------------------------------------------
// A CMS row arrives from a scan or a feed with an AWB and little else, and the
// fields it is missing are the ones that decide whether it can be filed at all:
// the account, the identifier that account's claim form is keyed on, and — once
// a ticket exists — where that ticket now stands.
//
// Every one of those is knowable by ASKING the marketplace, which is what this
// describes: per platform, the fields Refill can resolve, and the call that
// resolves each. One entry per field even where one call answers several (the
// Meesho Returns search gives the account AND the sub-order number in the same
// response) — the field is what an operator picks, the call is an implementation
// detail, and the runner collapses the duplicates.
//
// `action: false` and `action: true` are different statements, and both are
// worth making:
//   true  + endpoint   the call exists in this package and Refill uses it
//   false + reason     the marketplace does not answer this on any path we know
// An absent entry means the field is not offered on that platform at all.
//
// AJIO IS THE ONE PLATFORM THAT IS NOT ASKED. Its seller portal is read in bulk
// rather than per claim, and the desktop app already keeps a local copy of those
// reports (Trackvid-CMS "AJIO master data backup"). A return AWB is a row in
// that copy, and the row carries the forward AWB, the seller SKU and the POB —
// so Refill reads it instead of making four network calls for something already
// on disk. `api: null` says exactly that: the answer is local.
//
// A consumer without that backup cannot offer AJIO refill. Today only the
// desktop app does, which is why the resolver lives there.
//
// NYKAA HAS ONE FIELD AND ONE ONLY: the claim status. It has no per-claim
// account — the company's single Nykaa login files everything — and no
// sub-order or forward AWB to repair. What it does have is a ticket whose state
// moves after filing, which is the one thing nobody can see from the row.
// -----------------------------------------------------------------------------

/**
 * @typedef {object} RefillFieldConfig
 * @property {boolean} action      whether Refill will attempt this field
 * @property {string|null} api     the core function that answers it
 * @property {string} [endpoint]   the marketplace call that function makes
 * @property {string} [reason]     why `action` is false
 */

/** What Refill can resolve, per platform. @type {Record<string, Record<string, RefillFieldConfig>>} */
const { platformKey } = require("./platforms.js");

const REFILL_CONFIG = {
    ajio: {
        // The POB the row belongs to decides the account: every place of
        // business sits under exactly one login, so a matched row names its
        // account without anybody signing in.
        accountMapping: {
            action: true,
            api: null,
            endpoint: "local master-data backup → pobId, resolved against the account's POBs",
        },
        forwardAwbNumber: {
            action: true,
            api: null,
            endpoint: "local master-data backup, return report → fwdAwbNo",
        },
        sellerSku: {
            action: true,
            api: null,
            endpoint: "local master-data backup, return report → sellerSku",
        },
        pobId: {
            action: true,
            api: null,
            endpoint: "local master-data backup, return report → pobId",
        },
        /**
         * The one AJIO field that is NOT local: a ticket's state lives with
         * AJIO, not in the reports this machine backs up. Read from the help
         * centre by the ticket number the claim already carries.
         */
        statusChange: {
            action: true,
            api: "platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow#getTicketStatus",
            endpoint: "GET /malekith/castellan/api/v1/tickets?ticketId=<id>&ticketDateRange=<range>",
        },
    },

    myntra: {
        accountMapping: {
            action: true,
            api: "platforms/myntra/account-mapping/api-based-flow/probeAwb#probeMyntraAwb",
            endpoint: "GET /api/spf/fetchNewClaim?fetchAccio=true&id=<awb>",
        },
        // The forward leg's tracking id, which Myntra answers with while
        // confirming the return belongs to the account — so on Myntra this
        // costs nothing beyond the mapping call.
        forwardAwbNumber: {
            action: true,
            api: "platforms/myntra/claim-management/api-based-flow/claimApiFlow#fetchNewClaim",
            endpoint: "GET /api/spf/fetchNewClaim?fetchAccio=true&id=<awb> → trackingId",
        },
        statusChange: {
            action: true,
            api: "platforms/myntra/claim-management/api-based-flow/claimApiFlow#fetchClaimByTicketId",
            endpoint: "GET /api/spf/fetchClaimByTicketId?fetchAccio=true&id=<ticketId>",
        },
    },

    meesho: {
        accountMapping: {
            action: true,
            api: "platforms/meesho/common/returnsSearch#searchReturns",
            endpoint: "POST /api/fulfillment/returnRto/fetchReturnClaims",
        },
        // The SAME response. Kept as its own field because it is its own
        // decision — a row can have the right account and the wrong sub-order
        // number, and Meesho's claim form is keyed on the latter.
        subOrderNumber: {
            action: true,
            api: "platforms/meesho/common/returnsSearch#searchReturns",
            endpoint: "POST /api/fulfillment/returnRto/fetchReturnClaims → sub_order_num",
        },
        statusChange: {
            action: true,
            api: "platforms/meesho/claim-management/api-based-flow/claimApiFlow#searchTicketsBySubOrder",
            endpoint: "POST /api/experience/support/searchTickets",
        },
    },

    snapdeal: {
        accountMapping: {
            action: true,
            api: "platforms/snapdeal/account-mapping/api-based-flow/probeAwb#probeSnapdealAwb",
            endpoint: "GET /returns/globalSearch?searchTerm=<awb>&searchType=AWBNUMBER",
        },
        // Snapdeal's search answers with it, and its claim flow derives its own
        // at filing time — so it is stored because the question was already
        // asked, not because a claim needs it.
        subOrderNumber: {
            action: true,
            api: "platforms/snapdeal/account-mapping/api-based-flow/probeAwb#probeSnapdealAwb",
            endpoint: "GET /returns/globalSearch → returnsList[].subOrderId",
        },
        statusChange: {
            action: true,
            api: "platforms/snapdeal/claim-management/api-based-flow/claimApiFlow#getDisputes",
            endpoint: "Snapdeal disputes list, newest dispute for the AWB",
        },
    },

    flipkart: {
        accountMapping: {
            action: true,
            api: "platforms/flipkart/account-mapping/api-based-flow/probeAwb#probeFlipkartAwb",
            endpoint: "NAPI Payments_SPF_WEB_getOrderSearch",
        },
        statusChange: {
            action: true,
            api: "platforms/flipkart/claim-management/api-based-flow/claimApiFlow#findClaim",
            endpoint: "ORCH GetSpfClaimCountsOrchestrator + GetSpfClaimsOrchestrator",
        },
    },

    delhivery: {
        accountMapping: {
            action: true,
            api: "platforms/delhivery/account-mapping/api-based-flow/probeAwb#probeDelhiveryAwb",
            endpoint: "Delhivery client tickets, searched by AWB",
        },
        statusChange: {
            action: true,
            api: "platforms/delhivery/claim-management/api-based-flow/claimApiFlow#listLostDamageClaims",
            endpoint: "Delhivery lost/damaged claims list",
        },
    },

    tatacliq: {
        // ONE SEARCH ANSWERS BOTH FIELDS. The probe sweeps the login's slaves
        // and the eligibility response it gets back already carries the forward
        // AWB — so the second field costs nothing beyond the first, exactly as
        // it does on Myntra.
        accountMapping: {
            action: true,
            api: "platforms/tatacliq/account-mapping/api-based-flow/probeAwb#probeTataCliqAwb",
            endpoint: "POST /faces/oms/jqAjaxOmsResponse.jsp?flag=selectSearchFlagER, per slave",
        },
        forwardAwbNumber: {
            action: true,
            api: "platforms/tatacliq/account-mapping/api-based-flow/probeAwb#probeTataCliqAwb",
            endpoint: "the same search → the row's FWD anchor",
        },
        // The row shows a CRM ticket NUMBER when one exists, which answers
        // "already claimed" — but nothing in the portal captured so far reports
        // where that ticket now STANDS. Offering the field would fill the
        // status column with a guess, so it is declared unavailable instead.
        statusChange: {
            action: false,
            api: null,
            reason:
                "the Early Refund QC row carries a CRM ticket number but no ticket state, and no " +
                "Tata CliQ endpoint that reports one has been captured",
        },
    },

    nykaa: {
        // No accountMapping: there is no per-claim account to resolve. The
        // company's one Nykaa login owns every ticket, so asking which login
        // holds an AWB would be asking a question with one possible answer.
        statusChange: {
            action: true,
            api: "platforms/nykaa/claim-management/api-based-flow/claimApiFlow#findTicketByReverseAwb",
            endpoint: "GET /portal/api/tickets (indexed by cf.cf_awb_dto_rto, then the ticket's status)",
        },
    },

    xbees: {
        accountMapping: {
            action: true,
            api: "platforms/xbees/account-mapping/api-based-flow/probeAwb#probeXbeesAwb",
            endpoint: "Xbees dispute search by AWB",
        },
        // No status field: the dispute search answers whether one EXISTS, and
        // the claim flow already reads that at filing time. Add it here when a
        // Xbees endpoint reports a dispute's current state.
    },
};

/** Platforms Refill Data is offered on. */
const REFILL_PLATFORMS = Object.keys(REFILL_CONFIG);

/** The fields Refill can attempt for one platform, in the order they are shown. */
function refillFields(platform) {
    const config = REFILL_CONFIG[platformKey(platform)] || {};

    return Object.entries(config)
        .filter(([, field]) => field.action === true)
        .map(([name]) => name);
}

/** Can this platform resolve this field? */
function canRefill(platform, field) {
    const config = REFILL_CONFIG[platformKey(platform)] || {};

    return config[field]?.action === true;
}

module.exports = { REFILL_CONFIG, REFILL_PLATFORMS, refillFields, canRefill };
