const path = require("path");
const fs = require("fs-extra");
const logger = require("../../../../common/redactingLogger");
const { importMasterDataToTrackVid } = require("../api-based-flow/trackvidFunctions");
const { removeOrphanFile } = require("./puppeteerHelpers");
const { saveReportResource } = require("../../../../common/resourceSaver");

const FORWARD_REPORT_TYPE = "Dropship Order Report";

// ============================================================
// DASHBOARD / TAB NAVIGATION
// ============================================================

async function navigateToDashboard(page) {
    try {
        logger.info("📊 Navigating to Dashboard...");
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const currentUrl = page.url();
        logger.info(`🌐 Current URL: ${currentUrl}`);

        await page.waitForSelector("#mainWrapper", { timeout: 10000 });
        logger.info("✅ Dashboard loaded successfully");
        return true;
    } catch (error) {
        logger.error({ err: error }, "🚨 Dashboard navigation failed");
        throw error;
    }
}

async function navigateToTab(page, tabName) {
    try {
        logger.info(`📋 Navigating to ${tabName} tab...`);
        await new Promise((resolve) => setTimeout(resolve, 10000));
        await page.waitForSelector("#mainWrapper", { timeout: 10000 });

        let clicked = false;
        try {
            await page.click(`text=${tabName}`, { timeout: 5000 });
            clicked = true;
            logger.info(`✅ ${tabName} tab clicked via text selector`);
        } catch (e) {
            logger.info(`⚠️ text=${tabName} selector not found, trying fallback...`);
        }

        if (!clicked) {
            clicked = await page.evaluate((name) => {
                const elements = Array.from(document.querySelectorAll("a, span, div, button, p"));
                const target = elements.find(
                    (el) => el.textContent.trim().toLowerCase() === name.toLowerCase()
                );
                if (target) {
                    target.click();
                    return true;
                }
                return false;
            }, tabName);
            if (clicked) logger.info(`✅ ${tabName} tab clicked via evaluate fallback`);
        }

        if (!clicked) throw new Error(`${tabName} tab not found on page`);

        await new Promise((resolve) => setTimeout(resolve, 3000));
        logger.info(`✅ ${tabName} tab opened successfully`);
        return true;
    } catch (error) {
        logger.error({ err: error }, `❌ ${tabName} navigation failed`);
        throw error;
    }
}

// Meesho's sidebar layout varies between accounts:
//   • "Parent" layout — "Orders" is a collapsible parent; clicking it only
//     toggles the menu, and we must then click the "Manage Orders" sub-tab.
//   • "Leaf" layout — "Orders" is a direct nav item; clicking it lands on
//     the orders page immediately, with no sub-tab at all.
// We detect which layout we're on by checking for the "Download Orders Data"
// dropdown after the click — if it's there, we're already on the page.
async function navigateToManageOrders(page) {
    try {
        logger.info("📋 Navigating to Orders / Manage Orders...");
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await page.waitForSelector("#mainWrapper", { timeout: 10000 });

        const isOnOrdersPage = () => page.evaluate(() => {
            const isVisible = (el) => !!(el && el.offsetParent !== null);
            const labels = Array.from(
                document.querySelectorAll(".dropdown_label, p")
            );
            return labels.some(
                (el) =>
                    (el.textContent || "").trim().includes("Download Orders Data") &&
                    isVisible(el)
            );
        });

        if (await isOnOrdersPage()) {
            logger.info("ℹ️ Already on Orders page — skipping sidebar navigation");
            return true;
        }

        // Step A — Click "Orders" in the sidebar (expand sub-menu OR navigate)
        const expandResult = await page.evaluate(() => {
            const isVisible = (el) => !!(el && el.offsetParent !== null);

            // If the "Manage Orders" sub-tab is already visible, menu is open
            const manageVisible = Array.from(document.querySelectorAll("p"))
                .some((p) => p.textContent.trim() === "Manage Orders" && isVisible(p));
            if (manageVisible) return "already";

            const ordersP = Array.from(document.querySelectorAll("p"))
                .find((p) => p.textContent.trim() === "Orders");
            if (!ordersP) return false;

            const parent = ordersP.closest("div[data-active]") || ordersP;
            parent.click();
            return "clicked";
        });

        if (!expandResult) {
            throw new Error("'Orders' sidebar item not found");
        }

        if (expandResult === "clicked") {
            logger.info("✅ Clicked 'Orders' sidebar item");
            await new Promise((resolve) => setTimeout(resolve, 1500));
        } else {
            logger.info("ℹ️ 'Orders' sub-menu already expanded");
        }

        // Leaf-layout accounts: clicking "Orders" navigated us straight to
        // the orders page — no "Manage Orders" sub-tab exists. Done.
        if (await isOnOrdersPage()) {
            logger.info("ℹ️ 'Orders' is a leaf nav on this account — landed on Orders page");
            return true;
        }

        // Step B — Parent-layout accounts: click the "Manage Orders" sub-tab
        const clicked = await page.evaluate(() => {
            const target = Array.from(document.querySelectorAll("p"))
                .find((p) => p.textContent.trim() === "Manage Orders");
            if (!target) return false;
            const subTab = target.closest("div[data-active]") || target;
            subTab.click();
            return true;
        });

        if (!clicked) {
            throw new Error(
                "Neither landed on Orders page after clicking 'Orders' nor found a 'Manage Orders' sub-tab"
            );
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
        logger.info("✅ 'Manage Orders' opened successfully");
        return true;
    } catch (error) {
        logger.error({ err: error }, "❌ Manage Orders navigation failed");
        throw error;
    }
}

// ============================================================
// "DOWNLOAD ORDERS DATA" DROPDOWN + DATE RANGE MODAL
// ============================================================

async function openDownloadOrdersDropdown(page) {
    try {
        logger.info("📥 Opening 'Download Orders Data' dropdown...");


        const debugInfo = await page.evaluate(() => {
            const hasMainWrapper = !!document.querySelector('#mainWrapper');
            const dropdownLabels = Array.from(document.querySelectorAll('.dropdown_label')).map(el => el.textContent.trim().substring(0, 50));
            const allPsWithDownload = Array.from(document.querySelectorAll('p'))
                .filter(p => (p.textContent || "").toLowerCase().includes("download"))
                .map(p => ({ text: p.textContent.trim().substring(0, 60), classes: p.className }));
            return { hasMainWrapper, dropdownLabels, allPsWithDownload };
        });
        logger.info({ debugInfo }, "🔍 Page state before dropdown click");

        const clicked = await page.evaluate(() => {
            // Strategy 1: Find .dropdown_label containing "Download Orders Data"
            const labels = Array.from(document.querySelectorAll('.dropdown_label'));
            for (const label of labels) {
                const text = (label.textContent || "").trim();
                if (text.includes("Download Orders Data")) {
                    const headerContainer = label.parentElement;
                    if (headerContainer) {
                        headerContainer.click();
                        return "header-via-label";
                    }
                }
            }

            // Strategy 2: Find any <p> with exact text "Download Orders Data"
            // and click its closest MuiBox-root parent (the header row)
            const allPs = Array.from(document.querySelectorAll('p'));
            for (const p of allPs) {
                const text = (p.textContent || "").trim();
                if (text === "Download Orders Data") {
                    // Walk up through parents to find a suitable clickable container
                    // The header container is typically 3-4 levels above the <p>
                    let target = p.parentElement;
                    // Walk up until we find a div that also contains an SVG arrow (chevron)
                    for (let i = 0; i < 5 && target; i++) {
                        const hasSvg = target.querySelector('svg');
                        const hasLabel = target.querySelector('.dropdown_label') || target.classList.contains('dropdown_label');
                        if (hasSvg && (hasLabel || target.children.length >= 2)) {
                            target.click();
                            return "header-via-text-walk";
                        }
                        target = target.parentElement;
                    }
                    // Last resort: click the <p> itself
                    p.click();
                    return "p-direct";
                }
            }

            return null;
        });

        if (!clicked) throw new Error("'Download Orders Data' dropdown not found on page");
        logger.info(`✅ 'Download Orders Data' clicked via ${clicked}`);

        // Wait until the dropdown content is actually rendered — i.e. the
        // "Select Date Range" item is queryable. Without this, callers race
        // ahead and selectDateRange() fails on retries / between chunks.
        logger.info("⏳ Waiting for dropdown content ('Select Date Range') to render...");
        await waitForDropdownContent(page);
        logger.info("✅ Dropdown content rendered");

        return true;
    } catch (error) {
        logger.error({ err: error }, "🚨 Failed to open download dropdown");
        throw error;
    }
}

/**
 * Poll until the "Select Date Range" item is present inside the dropdown.
 * Used after every dropdown open so the next interaction doesn't race.
 */
async function waitForDropdownContent(page, timeout = 15000) {
    await page.waitForFunction(
        () => {
            return Array.from(document.querySelectorAll("div, p, span, button")).some((el) => {
                const text = (el.textContent || "").trim();
                return text === "Select Date Range" && el.offsetParent !== null;
            });
        },
        { timeout, polling: 500 }
    );
}

async function openingDateRangeModal(page) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    logger.info("📋 Step 1: Checking dropdown content...");

    const selectDateRangeSelector =
        "#mainWrapper > div > div.MuiBox-root.css-1qqkpp3 > section > div.MuiBox-root.css-1rstqaz > div.MuiBox-root.css-1tz5xm6 > div > div > div.MuiBox-root.css-riuhqi > div > div.MuiBox-root.css-1xdhyk6 > div.MuiBox-root.css-1s3va3x > div.MuiBox-root.css-11wf9ko";

    await page.waitForFunction(
        (selector) => {
            const exactMatch = document.querySelector(selector);
            if (exactMatch) return true;
            return Array.from(document.querySelectorAll("div, p, span, button")).some((el) => {
                const text = (el.textContent || "").trim();
                return text.includes("Select Date Range");
            });
        },
        { timeout: 15000 },
        selectDateRangeSelector
    );

    logger.info("📋 Step 2: Clicking 'Select Date Range'...");
    const dateRangeClicked = await page.evaluate(() => {
        // Find the <p> element with exact text "Select Date Range"
        const allPs = Array.from(document.querySelectorAll('p'));
        for (const p of allPs) {
            if (p.textContent.trim() === "Select Date Range" && p.offsetParent !== null) {
                // Click the parent div (the container with calendar icon + text)
                // which is the actual clickable target
                const container = p.parentElement;
                if (container) {
                    container.click();
                    return "container";
                }
                p.click();
                return "p-direct";
            }
        }
        return null;
    });

    if (!dateRangeClicked) {
        throw new Error("'Select Date Range' button not found in dropdown");
    }
    logger.info(`✅ 'Select Date Range' clicked via ${dateRangeClicked}`);

    logger.info("⏳ Waiting 10s for 'Select Orders Date Range' modal...");
    await new Promise((resolve) => setTimeout(resolve, 10000));
}

// ============================================================
// DATE UTILS + CHUNKING
// ============================================================

/** Format Date → "DD/MM/YYYY" (Meesho's display format). */
function formatDate(date) {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

/** Convert "DD/MM/YYYY" → "YYYY-MM-DD". */
function formatDateToYYYYMMDD(dateStr) {
    const [d, m, y] = dateStr.split("/");
    return `${y}-${m}-${d}`;
}

/**
 * Last 28 days as a single chunk: (today - 28 days) → today.
 * Returned as a one-element array to keep the retry-loop shape consistent
 * with the incremental flow.
 */
function getLast28DaysChunk(toDate = new Date()) {
    const today = new Date(toDate);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 28);
    return [{ fromDate: formatDate(fromDate), toDate: formatDate(today) }];
}

/** Single chunk: lastSync → today. */
function getIncrementalChunk(lastSyncDate, toDate = new Date()) {
    return [
        {
            fromDate: formatDate(new Date(lastSyncDate)),
            toDate: formatDate(toDate),
        },
    ];
}

// ============================================================
// CALENDAR INTERACTION
// ============================================================

// Month label is no longer rendered in the calendar UI, so we navigate blind:
// caller tells us which month the calendar is currently on, we compute the
// signed month delta and click prev/next that many times.
async function navigateToMonth(page, targetMonth, targetYear, currentMonth, currentYear) {
    try {
        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ];
        const targetLabel = `${monthNames[targetMonth - 1]} ${targetYear}`;
        const currentLabel = `${monthNames[currentMonth - 1]} ${currentYear}`;

        const monthDelta = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);

        if (monthDelta === 0) {
            logger.info(`  ✅ Calendar already on ${targetLabel}`);
            return;
        }

        const ariaLabel = monthDelta < 0 ? "Previous month" : "Next month";
        const clicks = Math.abs(monthDelta);

        logger.info(
            `  🔄 Assumed current: ${currentLabel} → target: ${targetLabel}, clicking "${ariaLabel}" ${clicks} time(s)`
        );

        for (let i = 0; i < clicks; i++) {
            const result = await page.evaluate((label) => {
                const button = document.querySelector(`button[aria-label="${label}"]`);
                if (!button) return { found: false };
                if (button.disabled || button.classList.contains("Mui-disabled")) {
                    return { found: true, disabled: true };
                }
                button.click();
                return { found: true, clicked: true };
            }, ariaLabel);

            if (!result.found) {
                throw new Error(`Could not find "${ariaLabel}" button`);
            }
            if (result.disabled) {
                throw new Error(
                    `"${ariaLabel}" button is disabled after ${i} click(s) toward ${targetLabel}`
                );
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
        }

        logger.info(`  ✅ Reached ${targetLabel}`);
    } catch (error) {
        logger.warn(`⚠️ Month navigation issue: ${error.message}`);
        throw error;
    }
}

async function clickDayOnCalendar(page, day) {
    try {
        // Find day button directly — no modal selector dependency
        const dayClicked = await page.evaluate((targetDay) => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const dayButton = buttons.find((btn) => {
                const buttonText = (btn.textContent || "").trim();
                const isDisabled = btn.disabled || btn.classList.contains("Mui-disabled");
                return buttonText === String(targetDay) && !isDisabled;
            });
            if (!dayButton) return false;
            dayButton.click();
            return true;
        }, day);

        if (!dayClicked) throw new Error(`Day ${day} not found or disabled on calendar`);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        logger.info(`  ✅ Clicked day: ${day}`);
    } catch (error) {
        logger.error(`❌ Failed to click day ${day}: ${error.message}`);
        throw error;
    }
}

async function selectDateRange(page, fromDate, toDate) {
    try {
        logger.info(`📅 Selecting date range: ${fromDate} → ${toDate}`);

        // Click "Select Date Range" item again (modal needs it on each open)
        const selectDateRangeClicked = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll("*"));
            const target = elements.find(
                (el) =>
                    (el.tagName === "P" || el.tagName === "DIV" || el.tagName === "SPAN") &&
                    el.textContent.trim() === "Select Date Range"
            );
            if (target) {
                target.click();
                return true;
            }
            return false;
        });

        if (!selectDateRangeClicked) {
            throw new Error("Could not find 'Select Date Range' item in dropdown");
        }

        // Wait for modal
        const dateRangeModalSelector = 'div[role="presentation"], div.MuiDialog-root';
        await page.waitForSelector(dateRangeModalSelector, { visible: true, timeout: 10000 });
        logger.info("✅ Date picker modal detected");

        const [fromDay, fromMonth, fromYear] = fromDate.split("/").map(Number);
        const [toDay, toMonth, toYear] = toDate.split("/").map(Number);

        // Modal opens on the real-world current month (no label is rendered to verify).
        const today = new Date();
        const todayMonth = today.getMonth() + 1;
        const todayYear = today.getFullYear();

        // FROM
        logger.info(`  📅 Navigating to FROM ${fromMonth}/${fromYear}`);
        await navigateToMonth(page, fromMonth, fromYear, todayMonth, todayYear);
        await clickDayOnCalendar(page, fromDay);
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // TO — calendar stays on FROM month after a day click in MUI range pickers.
        logger.info(`  📅 Navigating to TO ${toMonth}/${toYear}`);
        await navigateToMonth(page, toMonth, toYear, fromMonth, fromYear);
        await clickDayOnCalendar(page, toDay);

        await new Promise((resolve) => setTimeout(resolve, 5000));
        logger.info("✅ Date selection complete");
        return true;
    } catch (error) {
        logger.error({ err: error }, "🚨 Date selection failed");
        throw error;
    }
}

// ============================================================
// EXPORT + DOWNLOAD
// ============================================================

async function clickExportData(page) {
    try {
        logger.info("⏳ Waiting 5s before forward export click...");
        await new Promise((resolve) => setTimeout(resolve, 5000));

        logger.info("🖱️ [Forward] Clicking 'Export data' button...");

        await page.waitForFunction(() => {
            return Array.from(document.querySelectorAll('button')).some(btn => {
                const txt = (btn.textContent || '').trim();
                if (txt !== 'Export data') return false;
                if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
                const r = btn.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && btn.offsetParent !== null;
            });
        }, { timeout: 15000, polling: 500 });

        const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const btn = buttons.find(b => {
                const txt = (b.textContent || '').trim();
                if (txt !== 'Export data') return false;
                if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
                const r = b.getBoundingClientRect();
                return r.width > 0 && r.height > 0 && b.offsetParent !== null;
            });
            if (!btn) return false;
            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return true;
        });

        if (!clicked) {
            throw new Error("'Export data' button not found or not clickable");
        }
        logger.info("✅ Export button clicked");

        await new Promise((resolve) => setTimeout(resolve, 5000));
        return true;
    } catch (error) {
        logger.error({ err: error }, "🚨 Error in clickExportData");
        return false;
    }
}

async function findAndDownloadExportedFile(page, downloadPath, fromDate, toDate) {
    logger.info("🔄 Reloading page to find generated file...");
    const client = await page.createCDPSession();
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath });

    // Snapshot tempFiles BEFORE clicking download so we can identify the new
    // file via set diff (defensive — even with the strict-invariant model,
    // this protects against any stray pre-existing file).
    fs.ensureDirSync(downloadPath);
    const beforeSnapshot = new Set(fs.readdirSync(downloadPath));
    logger.info(`📸 Snapshot before download: ${beforeSnapshot.size} file(s) already in tempFiles`);

    await page.reload({ waitUntil: "networkidle2" });
    await openDownloadOrdersDropdown(page);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const fromYYYYMMDD = formatDateToYYYYMMDD(fromDate);
    const toYYYYMMDD = formatDateToYYYYMMDD(toDate);
    const today = new Date();
    const todayYYYYMMDD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const targetTitle = `${fromYYYYMMDD}_${toYYYYMMDD}_${todayYYYYMMDD}`;
    logger.info(`🔍 Searching for download item titled: ${targetTitle}`);

    // Meesho generates the report asynchronously. Right after clicking Export
    // the dropdown shows "We will notify you once it's ready" and the row
    // appears only when the server-side file is ready (can take 30s–2min).
    // Poll the DOM instead of one-shot checking. Relaxed match: anchor on
    // the toDate + today-exported-date suffix in case Meesho normalizes the
    // fromDate. Also accept a row whose timestamp matches today as a final
    // fallback (covers any title-format drift on Meesho's side).
    const titleSuffix = `_${toYYYYMMDD}_${todayYYYYMMDD}`;
    const POLL_INTERVAL_MS = 5000;
    const MAX_WAIT_MS = 180000;
    const pollStart = Date.now();
    let matchedTitle = null;

    while (Date.now() - pollStart < MAX_WAIT_MS) {
        const result = await page.evaluate(
            (exactTitle, suffix) => {
                const titleEls = Array.from(document.querySelectorAll("[title]"))
                    .filter((el) => {
                        const t = el.getAttribute("title") || "";
                        return /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(t);
                    });
                const allTitles = titleEls.map((el) => el.getAttribute("title"));
                // 1) exact match preferred
                const exact = titleEls.find((el) => el.getAttribute("title") === exactTitle);
                if (exact) return { allTitles, matched: exact.getAttribute("title") };
                // 2) relaxed: toDate + today-exported suffix
                const relaxed = titleEls.find((el) => el.getAttribute("title").endsWith(suffix));
                if (relaxed) return { allTitles, matched: relaxed.getAttribute("title") };
                return { allTitles, matched: null };
            },
            targetTitle,
            titleSuffix
        );

        if (result.matched) {
            matchedTitle = result.matched;
            if (matchedTitle === targetTitle) {
                logger.info(`✅ Found generated report (exact): ${matchedTitle}`);
            } else {
                logger.info(
                    `✅ Found generated report (relaxed suffix match): ${matchedTitle} — expected ${targetTitle}`
                );
            }
            break;
        }

        const elapsed = Math.round((Date.now() - pollStart) / 1000);
        logger.info(
            `⏳ Report row not ready yet (${elapsed}s elapsed). Visible report titles: ${JSON.stringify(result.allTitles)}`
        );
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    if (!matchedTitle) {
        throw new Error(
            `Could not find download row for ${targetTitle} after ${MAX_WAIT_MS / 1000}s of polling`
        );
    }

    // Click the Download button inside the matched row. The DOM looks like:
    //   <div class="_1acbgre6 ...">                <-- row container
    //     <div class="_1acbgre7">                  <-- left column (title + timestamp)
    //       <div title="..."><p>...</p></div>      <-- [title] element we matched
    //     </div>
    //     <div ...>                                <-- right column
    //       <img src=".../download-blue.svg" />
    //       <span>Download</span>                  <-- the click target
    //     </div>
    //   </div>
    // We walk up from the matched [title] element until we find an ancestor
    // that ALSO contains a <span>Download</span> sibling — that's the row.
    //
    // Sometimes Meesho renders the row before the Download span is hydrated.
    // If we find the title row but no Download span, wait 15s, reload, reopen
    // the dropdown and try again (up to MAX_CLICK_ATTEMPTS times).
    const MAX_CLICK_ATTEMPTS = 3;
    let downloadClicked = { clicked: false };

    for (let attempt = 1; attempt <= MAX_CLICK_ATTEMPTS; attempt++) {
        downloadClicked = await page.evaluate((title) => {
            const titleEl = Array.from(document.querySelectorAll("[title]")).find(
                (el) => el.getAttribute("title") === title
            );
            if (!titleEl) return { clicked: false, reason: "title element not on page" };

            let ancestor = titleEl.parentElement;
            while (ancestor && ancestor !== document.body) {
                const downloadSpan = Array.from(ancestor.querySelectorAll("span")).find(
                    (s) => s.textContent.trim() === "Download"
                );
                if (downloadSpan) {
                    downloadSpan.click();
                    return { clicked: true };
                }
                ancestor = ancestor.parentElement;
            }
            return {
                clicked: false,
                reason: "no <span>Download</span> found in any ancestor of the title row",
            };
        }, matchedTitle);

        if (downloadClicked.clicked) break;

        if (attempt < MAX_CLICK_ATTEMPTS) {
            logger.warn(
                `⚠️ Found title "${matchedTitle}" but Download button missing (${downloadClicked.reason}). ` +
                    `Waiting 15s, reloading page and retrying (attempt ${attempt}/${MAX_CLICK_ATTEMPTS})...`
            );
            await new Promise((resolve) => setTimeout(resolve, 15000));
            try {
                await page.reload({ waitUntil: "networkidle2" });
            } catch (reloadErr) {
                logger.warn(`⚠️ Reload error during retry: ${reloadErr.message}`);
            }
            try {
                await openDownloadOrdersDropdown(page);
            } catch (dropdownErr) {
                logger.warn(`⚠️ Could not reopen dropdown after reload: ${dropdownErr.message}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    if (!downloadClicked.clicked) {
        throw new Error(
            `Could not click Download button for ${matchedTitle} after ${MAX_CLICK_ATTEMPTS} attempts: ${downloadClicked.reason}`
        );
    }

    logger.info("✅ Download button clicked. Waiting for file...");

    const startTime = Date.now();
    const maxWaitTime = 120000;
    while (Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const files = fs.readdirSync(downloadPath);
        // Find a NEW file (not present in the pre-download snapshot)
        const newCsv = files.find(
            (f) =>
                !beforeSnapshot.has(f) &&
                !f.includes(".crdownload") &&
                (f.endsWith(".csv") || f.endsWith(".xlsx"))
        );
        if (newCsv) {
            const filePath = path.join(downloadPath, newCsv);
            logger.info(`✅ File downloaded: ${newCsv}`);
            return { filePath, fileName: newCsv };
        }
        logger.info(`⏳ Still waiting for file... (${Math.round((Date.now() - startTime) / 1000)}s)`);
    }
    throw new Error("Download timeout - no new CSV file found");
}

async function downloadDataForRange(page, fromDate, toDate, downloadPath, config) {
    let downloadedFilePath = null;

    try {
        logger.info(`📥 DOWNLOADING: ${fromDate} → ${toDate}`);

        await selectDateRange(page, fromDate, toDate);
        await new Promise((resolve) => setTimeout(resolve, 10000));

        await clickExportData(page);
        await new Promise((resolve) => setTimeout(resolve, 5000));

        const result = await findAndDownloadExportedFile(page, downloadPath, fromDate, toDate);
        downloadedFilePath = result.filePath;
        logger.info(`✅ Download complete for ${fromDate} → ${toDate}`);

        // Upload immediately. The helper unlinks the file on success.
        await saveReportResource({
            srcPath: result.filePath,
            companyId: config.companyId,
            companyName: config.companyName,
            direction: "Forward",
            filename: result.fileName,
        });
        logger.info(`📤 Uploading ${result.fileName} to TrackVid...`);
        const uploadResp = await importMasterDataToTrackVid(
            FORWARD_REPORT_TYPE,
            result.filePath,
            config
        );

        if (!uploadResp || uploadResp.error) {
            const reason = uploadResp?.error || "empty response from TrackVid API";
            throw new Error(`Upload failed for ${result.fileName}: ${reason}`);
        }

        logger.info(`✅ ${result.fileName} uploaded to TrackVid`);
        // Helper already unlinked on success — clear the tracker so the catch
        // block does not try to delete a file that no longer exists.
        downloadedFilePath = null;

        return result;
    } catch (error) {
        logger.error({ err: error }, `🚨 downloadDataForRange failed for ${fromDate} → ${toDate}`);

        // If a file was downloaded but upload failed (or threw before unlink),
        // remove it so the next retry / next chunk starts with a clean folder.
        removeOrphanFile(downloadedFilePath);

        throw error;
    }
}

async function downloadLast28Days(page, downloadPath, config) {
    const chunks = getLast28DaysChunk();
    const results = [];
    const MAX_RETRIES = 2;

    logger.info(
        `📦 DOWNLOADING LAST 28 DAYS — single chunk ${chunks[0].fromDate} → ${chunks[0].toDate}`
    );

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let attempt = 0;
        let chunkSuccess = false;

        while (attempt <= MAX_RETRIES && !chunkSuccess) {
            logger.info(
                `📦 Chunk ${i + 1}/${chunks.length}: ${chunk.fromDate} → ${chunk.toDate} (attempt ${attempt + 1})`
            );

            try {
                const result = await downloadDataForRange(
                    page,
                    chunk.fromDate,
                    chunk.toDate,
                    downloadPath,
                    config
                );
                results.push({ ...chunk, ...result, success: true });
                chunkSuccess = true;
                logger.info(`✅ Chunk ${i + 1} downloaded`);

                // Reload + reopen for the next chunk so the UI stays in a clean state.
                // Wait long enough for the SPA to remount #mainWrapper before
                // we try to click the dropdown.
                if (i < chunks.length - 1) {
                    logger.info("🔄 Reloading page for next chunk...");
                    await page.reload({ waitUntil: "networkidle2" });
                    await new Promise((resolve) => setTimeout(resolve, 8000));
                    await page.waitForSelector("#mainWrapper", { timeout: 20000 });
                    await openDownloadOrdersDropdown(page);
                }
            } catch (error) {
                attempt++;
                logger.error(`⚠️ Chunk ${i + 1} attempt ${attempt} failed: ${error.message}`);

                if (attempt <= MAX_RETRIES) {
                    // Escalating backoff — give the page progressively more time
                    // on each retry so the SPA fully re-renders before we touch
                    // the dropdown again.
                    const backoffMs = 10000 + attempt * 5000; // 15s, 20s, ...
                    logger.info(
                        `🔄 Reloading and retrying chunk ${i + 1} after ${backoffMs / 1000}s...`
                    );
                    try {
                        await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
                    } catch (reloadError) {
                        logger.warn(`⚠️ Reload error: ${reloadError.message} — continuing`);
                    }
                    await new Promise((resolve) => setTimeout(resolve, backoffMs));

                    try {
                        await page.waitForSelector("#mainWrapper", { timeout: 20000 });
                    } catch (e) {
                        logger.warn(`⚠️ #mainWrapper not visible after reload: ${e.message}`);
                    }

                    try {
                        await openDownloadOrdersDropdown(page);
                    } catch (dropdownError) {
                        logger.warn(
                            `⚠️ Failed to reopen dropdown on retry: ${dropdownError.message}`
                        );
                    }
                } else {
                    logger.error(`❌ Chunk ${i + 1} failed after ${MAX_RETRIES + 1} attempts`);
                    results.push({ ...chunk, success: false, error: error.message });
                }
            }
        }
    }

    return results;
}

async function downloadIncrementalData(page, lastSyncDate, downloadPath, config) {
    const chunks = getIncrementalChunk(lastSyncDate);
    logger.info(`📦 DOWNLOADING INCREMENTAL DATA from ${chunks[0].fromDate} → ${chunks[0].toDate}`);

    try {
        const result = await downloadDataForRange(
            page,
            chunks[0].fromDate,
            chunks[0].toDate,
            downloadPath,
            config
        );
        return [{ ...chunks[0], ...result, success: true }];
    } catch (error) {
        logger.error({ err: error }, "❌ Incremental download failed");
        throw error;
    }
}

// ============================================================
// HIGH-LEVEL ENTRY POINT (called from script.js)
// ============================================================

/**
 * Run the full forward-orders flow for one config.
 * Assumes the user is already logged in.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} config — must include scenario, lastSyncDate?, tempFilePath
 * @returns {Promise<{ chunks: Array }>}
 */
async function runForwardFlow(page, config) {
    logger.info("📦 === FORWARD ORDERS FLOW ===");

    // Step 1 — Navigate to Orders → Manage Orders
    try {
        await navigateToManageOrders(page);
    } catch (err) {
        throw new Error(`Step 1 (Navigate to Manage Orders) failed: ${err.message}`);
    }

    // Step 2 — Open "Download Orders Data" dropdown
    try {
        await openDownloadOrdersDropdown(page);
    } catch (err) {
        throw new Error(`Step 2 (Open 'Download Orders Data' dropdown) failed: ${err.message}`);
    }

    // Step 3 — Open the date range modal
    try {
        await openingDateRangeModal(page);
    } catch (err) {
        throw new Error(`Step 3 (Open date range modal) failed: ${err.message}`);
    }

    // Step 4 — Download data for the chosen scenario
    let downloadResults = [];
    try {
        if (config.scenario === "SCENARIO_2_INCREMENTAL" && config.lastSyncDate) {
            logger.info("📅 SCENARIO 2: INCREMENTAL (lastSync → today)");
            downloadResults = await downloadIncrementalData(
                page,
                config.lastSyncDate,
                config.tempFilePath,
                config
            );
        } else {
            logger.info("📅 SCENARIO 1: LAST 28 DAYS (single chunk)");
            downloadResults = await downloadLast28Days(page, config.tempFilePath, config);
        }
    } catch (err) {
        throw new Error(`Step 4 (Download data for scenario "${config.scenario}") failed: ${err.message}`);
    }

    const successCount = downloadResults.filter((r) => r.success).length;
    const failCount = downloadResults.filter((r) => !r.success).length;
    logger.info(`📊 Forward summary — ✅ ${successCount}/${downloadResults.length}  ❌ ${failCount}`);

    if (successCount === 0) {
        throw new Error("Step 4 (Download data) failed: all forward-order chunks failed to download");
    }

    return { chunks: downloadResults };
}

module.exports = {
    runForwardFlow,
    // Lower-level helpers exported for testing / reuse:
    navigateToDashboard,
    navigateToTab,
    navigateToManageOrders,
    openDownloadOrdersDropdown,
    openingDateRangeModal,
    selectDateRange,
    downloadLast28Days,
    downloadIncrementalData,
    formatDate,
    getLast28DaysChunk,
    getIncrementalChunk,
};
