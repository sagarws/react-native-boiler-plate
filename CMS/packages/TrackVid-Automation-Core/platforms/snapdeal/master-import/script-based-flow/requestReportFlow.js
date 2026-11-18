const fs = require("fs");
const path = require("path");
const os = require("os");
const logger = require("../../../../common/redactingLogger");
const {
    sleep,
    selectDropdownOption,
    navigateToReportsTab,
    openCreateReportModal,
    clickChooseDateRange,
    selectDateRange,
    clickApplyDateRange,
    clickGenerateReport,
    findReportCardByRequestTime,
} = require("../common/utils");

async function dumpPageOnFailure(page, label, context = {}) {
    if (!page) return;
    try {
        const safeLabel = String(label).replace(/[^a-z0-9-]+/gi, "_");
        const safeUser = String(context.username || "unknown").replace(/[^a-z0-9-]+/gi, "_");
        const stamp = Date.now();
        const baseDir = process.env.SNAPDEAL_DEBUG_DIR || os.tmpdir();
        const base = path.join(baseDir, `snapdeal-${safeLabel}-${safeUser}-${stamp}`);
        await page.screenshot({ path: `${base}.png`, fullPage: true });
        const html = await page.content();
        fs.writeFileSync(`${base}.html`, html);
        const url = page.url();
        logger.warn(
            { screenshot: `${base}.png`, html: `${base}.html`, url, ...context },
            `🪲 Saved failure artifacts for ${label}`
        );
    } catch (dumpErr) {
        logger.warn({ err: dumpErr.message, label }, "⚠️ Failed to capture failure artifacts");
    }
}


const IMPORT_TYPE_CONFIG = {
    returnOrderData: {
        fulfilmentMode: "Dropship",
        reportOption: "Returns",
        reportVariable: "Return Acknowledged",
        filterBy: "Created Date",
        get portalReportName() {
            return `${this.fulfilmentMode} ${this.reportVariable}`; // "Dropship Return Acknowledged"
        },
        trackvidReportType: "Dropship Rtv Report",
    },
};

function getImportTypeSpec(importType) {
    const spec = IMPORT_TYPE_CONFIG[importType];
    if (!spec) throw new Error(`Unknown Snapdeal importType: ${importType}`);
    return spec;
}


async function runRequestReportFlow(page, config) {
    const spec = getImportTypeSpec(config.importType);

    logger.info(
        { importType: config.importType, user: config.username },
        `📋 Starting request flow — ${spec.portalReportName}`
    );

    // Step 1 — go to Reports tab
    try {
        await navigateToReportsTab(page);
    } catch (err) {
        throw new Error(`Step 1 (Navigate to Reports tab) failed: ${err.message}`);
    }
    await sleep(2000);

    // Step 2 — open Create New Report modal
    try {
        await openCreateReportModal(page);
    } catch (err) {
        await dumpPageOnFailure(page, "step2-create-new-report", {
            username: config.username,
            importType: config.importType,
            errMessage: err.message,
        });
        throw new Error(`Step 2 (Open Create New Report modal) failed: ${err.message}`);
    }
    await sleep(2000);

    // Steps 3–6 — fill dropdowns
    try {
        await selectDropdownOption(page, "reportType", spec.reportOption);
    } catch (err) {
        throw new Error(`Step 3 (Select reportType "${spec.reportOption}") failed: ${err.message}`);
    }
    await sleep(2000);

    try {
        await selectDropdownOption(page, "fullfilmentMode", spec.fulfilmentMode);
    } catch (err) {
        throw new Error(`Step 4 (Select fulfilmentMode "${spec.fulfilmentMode}") failed: ${err.message}`);
    }
    await sleep(2000);

    try {
        await selectDropdownOption(page, "variableType", spec.reportVariable);
    } catch (err) {
        throw new Error(`Step 5 (Select variableType "${spec.reportVariable}") failed: ${err.message}`);
    }
    await sleep(2000);

    try {
        await selectDropdownOption(page, "queryType", spec.filterBy);
    } catch (err) {
        throw new Error(`Step 6 (Select queryType "${spec.filterBy}") failed: ${err.message}`);
    }
    await sleep(2000);

    // Step 7 — open the date range picker
    try {
        await clickChooseDateRange(page);
    } catch (err) {
        throw new Error(`Step 7 (Open date range picker) failed: ${err.message}`);
    }
    await sleep(2000);

    // Step 8 — compute date range.
    const MAX_INTERVAL_DAYS = 28;
    const endDate = new Date();
    const earliestAllowed = new Date(endDate);
    earliestAllowed.setDate(earliestAllowed.getDate() - MAX_INTERVAL_DAYS);

    let startDate;
    if (config.scenario === "SCENARIO_2_INCREMENTAL" && config.lastSyncDate) {
        const lastSync = new Date(config.lastSyncDate);
        if (Number.isNaN(lastSync.getTime())) {
            throw new Error(`Step 8 (Compute date range) failed: Invalid lastSyncDate "${config.lastSyncDate}"`);
        }
        startDate = lastSync < earliestAllowed ? earliestAllowed : lastSync;
    } else {
        startDate = earliestAllowed;
    }

    logger.info(
        {
            scenario: config.scenario,
            start: startDate.toISOString().slice(0, 10),
            end: endDate.toISOString().slice(0, 10),
        },
        "📅 Computed date range for report"
    );

    // Step 9 — select dates on pickers
    try {
        await selectDateRange(page, startDate, endDate);
    } catch (err) {
        throw new Error(`Step 9 (Select date range ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}) failed: ${err.message}`);
    }
    await sleep(2000);

    // Step 10 — click Apply to confirm date range
    try {
        await clickApplyDateRange(page);
    } catch (err) {
        throw new Error(`Step 10 (Click Apply date range) failed: ${err.message}`);
    }
    await sleep(2000);

    // Step 11 — submit the modal by clicking "Generate Report"
    let requestedAt;
    try {
        requestedAt = await clickGenerateReport(page);
        logger.info({ requestedAt }, "🕒 Generate Report clicked");
    } catch (err) {
        throw new Error(`Step 11 (Click Generate Report) failed: ${err.message}`);
    }
    await sleep(2000);

    // Let the modal close and the request register
    await sleep(5000);

    // Step 12 — Verification: reload and find the submitted card
    try {
        logger.info("🔄 Reloading Reports list to verify request appeared");
        await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
        await sleep(5000);

        await selectDropdownOption(page, "reportFilter", "Returns");
        await sleep(1500);

        const matchedCard = await findReportCardByRequestTime(page, {
            reportName: spec.portalReportName,
            requestedAt,
            toleranceMinutes: 2,
        });

        if (!matchedCard) {
            throw new Error(
                `No report card matched request time — Snapdeal may not have accepted the request for ${spec.portalReportName}`
            );
        }

        logger.info(
            {
                name: matchedCard.name,
                initiationText: matchedCard.initiationText,
                status: matchedCard.status,
            },
            "✅ Report request verified on list"
        );

        return {
            reportName: matchedCard.name,
            initiationText: matchedCard.initiationText,
            requestedAt,
            trackvidReportType: spec.trackvidReportType,
        };
    } catch (err) {
        throw new Error(`Step 12 (Verify report card appeared) failed: ${err.message}`);
    }
}

module.exports = {
    IMPORT_TYPE_CONFIG,
    getImportTypeSpec,
    runRequestReportFlow,
};
