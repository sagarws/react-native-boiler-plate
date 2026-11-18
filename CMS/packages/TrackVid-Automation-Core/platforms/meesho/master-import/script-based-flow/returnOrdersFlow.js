const path = require("path");
const fs = require("fs-extra");
const logger = require("../../../../common/redactingLogger");
const { navigateToTab } = require("./forwardOrdersFlow");
const { importMasterDataToTrackVid } = require("../api-based-flow/trackvidFunctions");
const { removeOrphanFile } = require("./puppeteerHelpers");
const { saveReportResource } = require("../../../../common/resourceSaver");

const RETURN_REPORT_TYPE = "Dropship Rtv Report";

// Date range picker is rendered inline. The two date inputs are readonly —
// clicking one opens an inline calendar dialog whose day cells are
// <button aria-label="Tue Jun 02 2026" data-today="false" ...>2</button>.
// We navigate months via the Previous/Next month buttons and click the day
// cell by its aria-label (matches Date.prototype.toDateString()).
const DATE_INPUT_SELECTOR = 'input[placeholder="DD/MM/YYYY"]';
const CALENDAR_DAY_SELECTOR = "button[aria-label][data-today]";

// ============================================================
// CUSTOM DATE RANGE PICKER (SCENARIO_1_ALL → custom range)
// ============================================================

/** Last 28 days as { fromDate, toDate } Date objects. */
function getLast28DaysRange(toDate = new Date()) {
    const today = new Date(toDate);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 28);
    return { fromDate, toDate: today };
}

/** Ensure the inline calendar is open. If it's already open we leave it alone
 *  (clicking the input again would toggle it closed). We re-query the input
 *  by index from inside the page because clicking FROM re-renders the inputs
 *  and any cached ElementHandle becomes detached. */
async function ensureCalendarOpen(page, inputIndex, label) {
    // Let the DOM settle from any prior interaction before probing it.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const alreadyOpen = await page.evaluate(
        (sel) => Boolean(document.querySelector(sel)),
        CALENDAR_DAY_SELECTOR
    );
    if (alreadyOpen) {
        logger.info(`🪟 [${label}] Calendar already open`);
        return;
    }

    logger.info(`🖱️ [${label}] Opening calendar (clicking date input #${inputIndex})`);
    const clicked = await page.evaluate(
        (sel, i) => {
            const inputs = document.querySelectorAll(sel);
            if (!inputs[i]) return false;
            inputs[i].focus();
            inputs[i].click();
            return true;
        },
        DATE_INPUT_SELECTOR,
        inputIndex
    );
    if (!clicked) {
        throw new Error(`[${label}] Date input #${inputIndex} not found`);
    }

    await page.waitForSelector(CALENDAR_DAY_SELECTOR, { timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
}

/** Click the calendar's prev/next month buttons until the displayed
 *  month/year matches `targetYear` and `targetMonth` (0-indexed). */
async function navigateCalendarToMonth(page, targetYear, targetMonth) {
    const MAX_CLICKS = 60;
    for (let i = 0; i < MAX_CLICKS; i++) {
        const current = await page.evaluate(() => {
            const m = document.querySelector('select[aria-label="Select month"]');
            const y = document.querySelector('select[aria-label="Select year"]');
            if (!m || !y) return null;
            return { month: parseInt(m.value, 10), year: parseInt(y.value, 10) };
        });
        if (!current) {
            throw new Error("Calendar month/year selects not found");
        }
        if (current.year === targetYear && current.month === targetMonth) return;

        const goBack =
            current.year > targetYear ||
            (current.year === targetYear && current.month > targetMonth);
        const navLabel = goBack ? "Previous month" : "Next month";
        const clicked = await page.evaluate((label) => {
            const btn = document.querySelector(`button[aria-label="${label}"]`);
            if (!btn || btn.disabled) return false;
            btn.click();
            return true;
        }, navLabel);
        if (!clicked) {
            throw new Error(
                `Cannot navigate calendar to ${targetYear}-${String(targetMonth + 1).padStart(2, "0")}: "${navLabel}" button unavailable`
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
        `Calendar navigation exhausted ${MAX_CLICKS} clicks before reaching ${targetYear}-${String(targetMonth + 1).padStart(2, "0")}`
    );
}

/** Click the day-cell button matching `date`. The cell's aria-label is
 *  Date.prototype.toDateString() — e.g. "Tue Jun 02 2026". */
async function pickDayInCalendar(page, date, label) {
    const ariaLabel = date.toDateString();
    logger.info(`🖱️ [${label}] Clicking day "${ariaLabel}"`);
    const result = await page.evaluate((aria) => {
        const btn = document.querySelector(`button[aria-label="${aria}"]`);
        if (!btn) return { ok: false, reason: "button-not-found" };
        if (btn.disabled || btn.getAttribute("data-disabled") === "true") {
            return { ok: false, reason: "disabled" };
        }
        btn.click();
        return { ok: true };
    }, ariaLabel);
    if (!result.ok) {
        throw new Error(`Day cell "${ariaLabel}" — ${result.reason}`);
    }
}

async function pickReturnsCustomDateRange(page, fromDate, toDate) {
    logger.info(
        `📅 [Returns] Picking custom date range: ${fromDate.toDateString()} → ${toDate.toDateString()}`
    );

    await page.waitForSelector(DATE_INPUT_SELECTOR, { visible: true, timeout: 15000 });
    logger.info("✅ Date inputs visible — waiting 1s to settle");
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // First input is FROM (index 0), second is TO (index 1). We don't cache
    // ElementHandles — clicking FROM re-renders the inputs and stale handles
    // would silently fail. ensureCalendarOpen re-queries by index each time.
    const inputCount = await page.evaluate(
        (sel) => document.querySelectorAll(sel).length,
        DATE_INPUT_SELECTOR
    );
    if (inputCount < 2) {
        throw new Error(`Expected 2 date inputs, found ${inputCount}`);
    }

    // FROM — open calendar via the FROM input, navigate, click day
    await ensureCalendarOpen(page, 0, "FROM");
    await navigateCalendarToMonth(page, fromDate.getFullYear(), fromDate.getMonth());
    await pickDayInCalendar(page, fromDate, "FROM");

    // TO — re-open via the TO input if the calendar auto-closed after the
    // first pick. ensureCalendarOpen is a no-op when it's still open.
    await ensureCalendarOpen(page, 1, "TO");
    await navigateCalendarToMonth(page, toDate.getFullYear(), toDate.getMonth());
    await pickDayInCalendar(page, toDate, "TO");
    await new Promise((resolve) => setTimeout(resolve, 1200));

    logger.info("🖱️ Clicking 'Apply' button...");
    const applyClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button"));
        const applyBtn = buttons.find((btn) => {
            if (btn.disabled) return false;
            const text = (btn.textContent || "").trim().toLowerCase();
            if (text !== "apply") return false;
            // Must be currently visible (filters out hidden/detached buttons elsewhere on page)
            return btn.offsetParent !== null;
        });
        if (!applyBtn) return false;
        applyBtn.click();
        return true;
    });

    if (!applyClicked) throw new Error("Could not find/click visible 'Apply' button");
    logger.info("✅ 'Apply' clicked");

    await new Promise((resolve) => setTimeout(resolve, 2000));

    logger.info("✅ Custom date range applied");
}


async function clickReturnExportData(page) {
    const attemptExportClick = async () => {
        // Click the files-ready dropdown (role="button" containing "files ready")
        logger.info("🖱️ [Returns] Clicking dropdown...");
        const dropdownClicked = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('[role="button"]'));
            const btn = btns.find((el) => el.textContent.includes("files ready"));
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!dropdownClicked) throw new Error("Could not find files-ready dropdown");

        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Click the "Export Data" button
        logger.info("🖱️ [Returns] Clicking 'Export Data' button...");
        const exportClicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button"));
            const btn = buttons.find((b) => b.textContent.trim() === "Export Data");
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!exportClicked) throw new Error("Could not find 'Export Data' button");
        logger.info("✅ 'Export Data' clicked");
    };


    try {
        await attemptExportClick();
    } catch (error) {
        logger.error({ err: error }, "🚨 Error in clickReturnExportData — will reload and retry");


        try {
            logger.info("🔄 Reloading page to recover from export-click error...");
            await page.reload({ waitUntil: ["domcontentloaded", "networkidle2"], timeout: 60000 });
            logger.info("✅ Page reloaded — retrying export click");
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await attemptExportClick();
        } catch (retryError) {
            logger.error({ err: retryError }, "🚨 Export click retry after reload also failed");
            return false;
        }
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Final reload so the download section reflects the freshly-triggered export.
    try {
        logger.info("🔄 Reloading page after export trigger...");
        await page.reload({ waitUntil: ["domcontentloaded", "networkidle2"], timeout: 60000 });
        logger.info("✅ Page reloaded");
    } catch (reloadErr) {
        if (reloadErr.message.includes("timeout")) {
            logger.warn("⚠️ Reload timed out, but proceeding anyway");
        } else {
            logger.warn(`⚠️ Reload error: ${reloadErr.message} — proceeding anyway`);
        }
    }
    return true;
}


async function downloadExportedReturnFile(page, targetLabel, downloadPath) {
    try {
        logger.info("🔄 Setting up download behavior...");
        const client = await page.createCDPSession();
        await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });


        fs.ensureDirSync(downloadPath);
        const beforeSnapshot = new Set(fs.readdirSync(downloadPath));
        logger.info(
            `📸 Snapshot before download: ${beforeSnapshot.size} file(s) already in tempFiles`
        );

        const candidateLabels = Array.isArray(targetLabel) ? targetLabel : [targetLabel];

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const now = new Date();
        const todayStr = `${String(now.getDate()).padStart(2, "0")} ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
        logger.info(`🔍 Looking for row: label=${candidateLabels.join(" | ")}, date=${todayStr}`);

        const MAX_LOADING_RETRIES = 3;
        let result = null;

        for (let attempt = 1; attempt <= MAX_LOADING_RETRIES; attempt++) {
            logger.info(`🖱️ Re-opening dropdown to download exported file... (attempt ${attempt}/${MAX_LOADING_RETRIES})`);

            // Click the files-ready dropdown
            const dropdownClicked = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('[role="button"]'));
                const btn = btns.find((el) => el.textContent.includes("files ready"));
                if (btn) { btn.click(); return true; }
                return false;
            });
            if (!dropdownClicked) throw new Error("Could not find files-ready dropdown");
            await new Promise((resolve) => setTimeout(resolve, 3000));

            // Check if still loading (look for "Processing" text)
            const isLoading = await page.evaluate(() => {
                const spans = Array.from(document.querySelectorAll("span"));
                return spans.some((el) => el.textContent.trim() === "Processing");
            });
            if (isLoading) {
                logger.warn(
                    `⏳ Export still preparing — loading indicator detected (attempt ${attempt}/${MAX_LOADING_RETRIES}). Waiting 15s then reloading...`
                );
                await new Promise((resolve) => setTimeout(resolve, 15000));
                if (attempt < MAX_LOADING_RETRIES) {
                    try {
                        await page.reload({
                            waitUntil: ["domcontentloaded", "networkidle2"],
                            timeout: 60000,
                        });
                    } catch (reloadErr) {
                        logger.warn(`⚠️ Reload error: ${reloadErr.message} — continuing`);
                    }
                    continue;
                }
                throw new Error(
                    `Export remained in loading state after ${MAX_LOADING_RETRIES} retries`
                );
            }

            // Find the row by title attribute and click its Download span
            result = await page.evaluate(
                (labels, date) => {
                    const titleEls = Array.from(document.querySelectorAll("[title]"));
                    for (const titleEl of titleEls) {
                        const titleVal = titleEl.getAttribute("title") || "";
                        const matchedLabel = labels.find((l) => titleVal.includes(l));
                        if (!matchedLabel) continue;

                        // Walk up to the row container (_1acbgre6)
                        const row = titleEl.closest("._1acbgre6") || titleEl.parentElement?.parentElement;
                        if (!row) continue;

                        // Check date if provided
                        if (date) {
                            const rowText = row.textContent || "";
                            if (!rowText.includes(date)) continue;
                        }

                        // Find Download span
                        const downloadBtn = Array.from(row.querySelectorAll("span")).find(
                            (el) => el.textContent.trim() === "Download"
                        );
                        if (downloadBtn) {
                            downloadBtn.click();
                            return { success: true, matchedLabel };
                        }
                    }
                    return {
                        success: false,
                        error: `Could not find row with label "${labels.join(" | ")}" and date "${date}"`,
                    };
                },
                candidateLabels,
                todayStr
            );

            if (result.success) break;
            // Not loading, but row not found — no point retrying, fail fast.
            throw new Error(result.error);
        }

        if (!result || !result.success) {
            throw new Error("Download row could not be resolved after retries");
        }

        logger.info("✅ Download button clicked. Waiting for file...");

        const startTime = Date.now();
        const maxWaitTime = 120000;
        while (Date.now() - startTime < maxWaitTime) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const files = fs.readdirSync(downloadPath);
            // Find a NEW file that wasn't in the pre-download snapshot
            const file = files.find(
                (f) =>
                    !beforeSnapshot.has(f) &&
                    !f.includes(".crdownload") &&
                    (f.endsWith(".csv") || f.endsWith(".xlsx"))
            );
            if (file) {
                const filePath = path.join(downloadPath, file);
                logger.info(`✅ File downloaded: ${file}`);
                return { filePath, fileName: file };
            }
        }
        throw new Error("Download timeout - no new file found");
    } catch (error) {
        logger.error({ err: error }, "🚨 Error in downloadExportedReturnFile");
        throw error;
    }
}

// ============================================================
// HIGH-LEVEL ENTRY POINT (called from script.js)
// ============================================================

/**
 * Run the full returns flow for one config.
 * Assumes the user is already logged in.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} config — must include scenario, tempFilePath
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
async function runReturnsFlow(page, config) {
    logger.info("📦 === RETURN ORDERS FLOW ===");

    // Step 1 — Navigate to Returns tab
    try {
        await navigateToTab(page, "Returns");
    } catch (err) {
        throw new Error(`Step 1 (Navigate to Returns tab) failed: ${err.message}`);
    }

    // Step 2 — Dismiss tooltip popup if present (best-effort, never fatal)
    logger.info("⏳ Waiting 7s for possible tooltip popup...");
    await new Promise((resolve) => setTimeout(resolve, 7000));
    try {
        const tooltipExists = await page.evaluate(
            (selector) => Boolean(document.querySelector(selector)),
            "#mui-11"
        );
        if (tooltipExists) {
            logger.info("🔍 Tooltip popup detected — closing it");
            await page.click("#mui-11 > div > div > div > div > div > svg");
            logger.info("✅ Tooltip closed");
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    } catch (e) {
        logger.warn(`⚠️ Step 2 (Dismiss tooltip) non-fatal warning: ${e.message}`);
    }

    // Step 3 — Ensure 'Return Tracking' sub-tab is selected
    try {
        logger.info("🖱️ Ensuring 'Return Tracking' sub-tab is selected...");
        const isTabAlreadySelected = await page.evaluate((tabName) => {
            const buttons = Array.from(document.querySelectorAll('button[role="tab"]'));
            const targetTab = buttons.find((btn) => btn.textContent.includes(tabName));
            if (!targetTab) throw new Error(`Could not find sub-tab with text: ${tabName}`);
            if (targetTab.getAttribute("aria-selected") === "true") return true;
            targetTab.click();
            return false;
        }, "Return Tracking");

        if (!isTabAlreadySelected) {
            await page.waitForFunction(
                (tabName) => {
                    const buttons = Array.from(document.querySelectorAll('button[role="tab"]'));
                    const targetTab = buttons.find((btn) => btn.textContent.includes(tabName));
                    return targetTab && targetTab.getAttribute("aria-selected") === "true";
                },
                { timeout: 15000 },
                "Return Tracking"
            );
        }
    } catch (err) {
        throw new Error(`Step 3 (Select 'Return Tracking' sub-tab) failed: ${err.message}`);
    }

    logger.info("⏳ Waiting 5s for Returns page to fully load...");
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Step 4 — Open the created_date preset dropdown
    try {
        logger.info("📥 Clicking Returns created_date dropdown...");
        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button"));
            const btn = buttons.find((b) => {
                const p = b.querySelector("p");
                return p && p.textContent.trim() === "Return Created";
            });
            if (btn) { btn.click(); return true; }
            return false;
        });
        if (!clicked) throw new Error("Could not find 'Return Created' dropdown button");
        await new Promise((resolve) => setTimeout(resolve, 3000));
    } catch (err) {
        throw new Error(`Step 4 (Open created_date dropdown) failed: ${err.message}`);
    }

    // Step 5 — Pick preset option (Custom Date Range or Yesterday fallback)
    const YESTERDAY_OPTION_SELECTOR = 'input[name="dropdown-created_date"][value="yesterday"]';
    const CUSTOM_RANGE_OPTION_SELECTOR = 'input[name="dropdown-created_date"][value="custom_date_range"]';

    let optionSelector = "";
    let useCustomRange = false;
    if (config.scenario === "SCENARIO_2_INCREMENTAL") {
        if (config.lastSyncDate) {
            logger.info("🎯 [Incremental] Selecting 'Custom Date Range' based on lastSyncDate");
            optionSelector = CUSTOM_RANGE_OPTION_SELECTOR;
            useCustomRange = true;
        } else {
            logger.info("🎯 [Incremental] No lastSyncDate — falling back to 'Yesterday' option");
            optionSelector = YESTERDAY_OPTION_SELECTOR;
        }
    } else {
        logger.info("🎯 Selecting 'Custom Date Range' option");
        optionSelector = CUSTOM_RANGE_OPTION_SELECTOR;
        useCustomRange = true;
    }

    try {
        await page.waitForSelector(optionSelector, { timeout: 10000 });
        const label = await page.evaluateHandle((sel) => {
            const input = document.querySelector(sel);
            return input ? input.closest("label") : null;
        }, optionSelector);
        if (label) await label.click();
        else await page.click(optionSelector);
    } catch (err) {
        throw new Error(`Step 5 (Select preset "${useCustomRange ? "Custom Date Range" : "Yesterday"}") failed: ${err.message}`);
    }

    // Step 6 — Apply custom date range if picker opened
    if (useCustomRange) {
        try {
            let fromDate;
            let toDate;
            if (config.scenario === "SCENARIO_2_INCREMENTAL") {
                fromDate = new Date(config.lastSyncDate);
                toDate = new Date();
            } else {
                ({ fromDate, toDate } = getLast28DaysRange());
            }
            await pickReturnsCustomDateRange(page, fromDate, toDate);
        } catch (err) {
            throw new Error(`Step 6 (Apply custom date range) failed: ${err.message}`);
        }
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Step 7 — Trigger export
    try {
        const exportSuccess = await clickReturnExportData(page);
        if (!exportSuccess) throw new Error("export trigger returned false");
    } catch (err) {
        throw new Error(`Step 7 (Trigger export) failed: ${err.message}`);
    }

    logger.info("📤 Export triggered. Starting download...");
    // Tell the downloader which row label to look for. The Custom Date Range
    // path can produce either "intransit_custom_date_range" or
    // "reverse_disposed_custom_date_range" depending on the seller's account.
    const downloadLabel = useCustomRange
        ? ["intransit_custom_date_range", "reverse_disposed_custom_date_range"]
        : "intransit_yesterday";

    // Step 8 — Download exported file
    let downloaded;
    try {
        downloaded = await downloadExportedReturnFile(
            page,
            downloadLabel,
            config.tempFilePath
        );
        if (!downloaded) throw new Error("downloader returned empty result");
    } catch (err) {
        const labelDesc = Array.isArray(downloadLabel) ? downloadLabel.join(" | ") : downloadLabel;
        throw new Error(`Step 8 (Download exported file "${labelDesc}") failed: ${err.message}`);
    }

    // Step 9 — Upload to TrackVid
    try {
        await saveReportResource({
            srcPath: downloaded.filePath,
            companyId: config.companyId,
            companyName: config.companyName,
            direction: "Return",
            filename: downloaded.fileName,
        });
        logger.info(`📤 Uploading ${downloaded.fileName} to TrackVid...`);
        let uploadResp;
        try {
            uploadResp = await importMasterDataToTrackVid(
                RETURN_REPORT_TYPE,
                downloaded.filePath,
                config
            );
        } catch (uploadErr) {
            // Unexpected throw from helper — clean up the file ourselves
            removeOrphanFile(downloaded.filePath);
            throw uploadErr;
        }

        if (!uploadResp || uploadResp.error) {
            // Helper returned an error — file is still on disk, delete it
            removeOrphanFile(downloaded.filePath);
            const reason = uploadResp?.error || "empty response from TrackVid API";
            throw new Error(reason);
        }
    } catch (err) {
        throw new Error(`Step 9 (Upload "${downloaded.fileName}" to TrackVid) failed: ${err.message}`);
    }

    logger.info(`✅ ${downloaded.fileName} uploaded to TrackVid`);
    logger.info(`📊 Returns summary — ✅ ${downloaded.fileName}`);
    return downloaded;
}

module.exports = {
    runReturnsFlow,
    clickReturnExportData,
    downloadExportedReturnFile,
};
