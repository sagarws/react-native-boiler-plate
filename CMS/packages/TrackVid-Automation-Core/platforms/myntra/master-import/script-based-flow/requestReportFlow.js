// -----------------------------------------------------------------------------
// Myntra master-data — request phase (per importType, per credential).
// Drives an already-logged-in driver through: Operational Reports →
// Store/Partner Type/Report dropdowns → date range → Generate Report →
// verify the row, returning everything Phase 2 needs to find the row again.
// -----------------------------------------------------------------------------

const logger = require("../../../../common/redactingLogger");
const {
    sleep,
    navigateToOperationalReports,
    selectUDropdownOption,
    fillDateRange,
    clickGenerateReport,
    getMyntraBannerError,
    findReportRowByDateRange,
    formatYMD,
} = require("../common/utils");

// Per-importType portal config. Extend here when new report types are wired up.
// `partnerType` is NOT here — it's per-credential (accountType from the DB).
const IMPORT_TYPE_CONFIG = {
    returnOrderData: {
        store: "MYNTRA",
        portalReportName: "Seller_Returns_Report",
        portalReportNameByPartnerType: {
            MDIRECT: "MDirect_Returns_Report",
        },
        lookbackDaysCap: 28,
        trackvidReportType: "returnReport",
    },
};

function resolvePortalReportName(spec, partnerType) {
    return spec.portalReportNameByPartnerType?.[partnerType] || spec.portalReportName;
}

// Config stores partnerType in uppercase (e.g. "MDIRECT"), but Myntra's Partner
// Type *dropdown* renders the option as "MDirect" — selectUDropdownOption needs
// the title-cased value or no option matches. Note: the report *table* column
// still renders "MDIRECT" (uppercase), so row matching must keep using the
// config value.
const PORTAL_PARTNER_TYPE_OVERRIDES = {
    MDIRECT: "MDirect",
};

function toPortalPartnerType(partnerType) {
    return PORTAL_PARTNER_TYPE_OVERRIDES[partnerType] || partnerType;
}

function getImportTypeSpec(importType) {
    const spec = IMPORT_TYPE_CONFIG[importType];
    if (!spec) throw new Error(`Unknown Myntra importType: ${importType}`);
    return spec;
}

// Try a few common Myntra timestamp formats; fall back to Date.parse so
// callers can decide whether to trust the result. Returns a Date or null.
// Examples seen in the wild: "2026-05-25 11:42:13", "25 May 2026, 11:42 AM",
// "2026-05-25T11:42:13".
function parseMyntraTimestamp(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;

    const native = new Date(s);
    if (!Number.isNaN(native.getTime())) return native;

    // "YYYY-MM-DD HH:MM:SS" → ISO
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (m) {
        const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || "00"}`;
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
}

// Phase 1 entry point for a single importType. `config` has username,
// password, importType, partnerType, scenario, lastSyncDate.
async function runRequestReportFlow(driver, config) {
    const spec = getImportTypeSpec(config.importType);
    if (!config.partnerType) {
        throw new Error("Missing partnerType (must come from credential's accountType)");
    }
    const portalReportName = resolvePortalReportName(spec, config.partnerType);
    const portalPartnerType = toPortalPartnerType(config.partnerType);

    logger.info(
        { importType: config.importType, user: config.username, partnerType: config.partnerType, portalPartnerType },
        `📋 Starting request flow — ${portalReportName}`
    );

    // Step 1 — navigate to Operational Reports
    try {
        await navigateToOperationalReports(driver);
    } catch (err) {
        throw new Error(`Step 1 (Navigate to Operational Reports) failed: ${err.message}`);
    }
    await sleep(2000);

    // Step 2 — fill the three UIKit dropdowns (Store, Partner Type, Report)
    try {
        await selectUDropdownOption(driver, "Store", spec.store);
    } catch (err) {
        throw new Error(`Step 2a (Select Store "${spec.store}") failed: ${err.message}`);
    }
    await sleep(1500);

    try {
        await selectUDropdownOption(driver, "Partner Type", portalPartnerType);
    } catch (err) {
        throw new Error(`Step 2b (Select Partner Type "${portalPartnerType}") failed: ${err.message}`);
    }
    await sleep(1500);

    try {
        await selectUDropdownOption(driver, "Report", portalReportName);
    } catch (err) {
        throw new Error(`Step 2c (Select Report "${portalReportName}") failed: ${err.message}`);
    }
    await sleep(1500);

    // Step 3 — compute date window. Myntra disables today's cell in the
    // picker, so the to-date anchors on yesterday. SCENARIO_2_INCREMENTAL
    // shortens the window when the last sync is recent.
    const today = new Date();
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() - 1);

    let fromDate;
    if (config.scenario === "SCENARIO_2_INCREMENTAL" && config.lastSyncDate) {
        const lastSync = new Date(config.lastSyncDate);
        if (Number.isNaN(lastSync.getTime())) {
            throw new Error(`Step 3 (Compute date range) failed: invalid lastSyncDate "${config.lastSyncDate}"`);
        }
        const earliestAllowed = new Date(today);
        earliestAllowed.setDate(earliestAllowed.getDate() - spec.lookbackDaysCap);
        fromDate = lastSync < earliestAllowed ? earliestAllowed : lastSync;
    } else {
        fromDate = new Date(today);
        fromDate.setDate(fromDate.getDate() - spec.lookbackDaysCap);
    }

    logger.info(
        { scenario: config.scenario, from: formatYMD(fromDate), to: formatYMD(toDate) },
        "📅 Computed date range"
    );

    // Step 4 — pick dates. Myntra disables not just today but the most recent
    // few days (data-settlement lag), so fillDateRange clamps the window to the
    // newest selectable cell and returns the dates it actually picked — Step 6
    // must verify the row against THOSE, not the originally-requested range.
    let pickedFrom = fromDate;
    let pickedTo = toDate;
    try {
        const picked = await fillDateRange(driver, fromDate, toDate);
        if (picked && picked.fromDate && picked.toDate) {
            pickedFrom = picked.fromDate;
            pickedTo = picked.toDate;
        }
    } catch (err) {
        throw new Error(
            `Step 4 (Pick date range ${formatYMD(fromDate)} → ${formatYMD(toDate)}) failed: ${err.message}`
        );
    }
    await sleep(1500);

    // Step 5 + 5b — submit and check for the red u-banner-error toast, with
    // retry. Myntra surfaces server-side scheduling failures (e.g. "Internal
    // server error while scheduling report job. (102008001)") in a toast
    // instead of returning a row. These are transient — a re-click of
    // Generate Report (the form stays filled) usually clears them — so retry
    // with backoff before giving up. Only the banner-error case is retried;
    // if the last attempt still shows the banner we throw MYNTRA_SCHEDULE_ERROR
    // so the operator sees the exact text in Mattermost at info level.
    const SUBMIT_MAX_ATTEMPTS = 3;
    let bannerError = null;
    for (let attempt = 1; attempt <= SUBMIT_MAX_ATTEMPTS; attempt++) {
        try {
            await clickGenerateReport(driver);
        } catch (err) {
            throw new Error(`Step 5 (Click Generate Report) failed: ${err.message}`);
        }
        await sleep(4000);

        bannerError = await getMyntraBannerError(driver);
        if (!bannerError) break;

        if (attempt < SUBMIT_MAX_ATTEMPTS) {
            const backoffMs = 10000 * attempt;
            logger.warn(
                { attempt, maxAttempts: SUBMIT_MAX_ATTEMPTS, bannerError, backoffMs },
                `⚠️ Myntra scheduling error — retrying Generate Report in ${backoffMs / 1000}s`
            );
            await sleep(backoffMs);
        }
    }
    if (bannerError) {
        const err = new Error(`Myntra: ${bannerError}`);
        err.code = "MYNTRA_SCHEDULE_ERROR";
        throw err;
    }

    // Step 6 — verify row appeared. Pulls Status + Expected Finish Time so
    // the dispatcher can schedule the download job dynamically.
    const dateRange = `${formatYMD(pickedFrom)} - ${formatYMD(pickedTo)}`;
    let matchedRow;
    try {
        matchedRow = await findReportRowByDateRange(driver, {
            store: spec.store,
            reportName: portalReportName,
            partnerType: config.partnerType,
            dateRange,
        });
    } catch (err) {
        throw new Error(`Step 6 (Verify report row) failed: ${err.message}`);
    }

    if (!matchedRow) {
        throw new Error(
            `Step 6 (Verify report row) failed: no row matched ${dateRange} — Myntra may not have accepted the request.`
        );
    }

    const expectedFinishDate = parseMyntraTimestamp(matchedRow.expectedFinish);

    logger.info(
        {
            store: matchedRow.store,
            reportName: matchedRow.reportName,
            partnerType: matchedRow.partnerType,
            dateRange: matchedRow.dateRange,
            status: matchedRow.status,
            expectedFinish: matchedRow.expectedFinish,
            expectedFinishParsed: expectedFinishDate ? expectedFinishDate.toISOString() : null,
        },
        "✅ Report request verified"
    );

    return {
        store: matchedRow.store,
        reportName: matchedRow.reportName,
        partnerType: matchedRow.partnerType,
        dateRange,
        queryDate: matchedRow.queryDate,
        status: matchedRow.status,
        expectedFinishRaw: matchedRow.expectedFinish || null,
        expectedFinishAt: expectedFinishDate, // Date or null
        trackvidReportType: spec.trackvidReportType,
    };
}

module.exports = {
    IMPORT_TYPE_CONFIG,
    getImportTypeSpec,
    parseMyntraTimestamp,
    runRequestReportFlow,
};
