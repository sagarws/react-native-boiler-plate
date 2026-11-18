

const {
    enableStealthMode,
    handleDialog,
    snapdealLogin,
} = require("../../claim-management/common/utils");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap snapdealLogin with retry. The shared login helper throws 
 */
async function snapdealLoginWithRetry(page, credentials, maxAttempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`🔁 Login attempt ${attempt}/${maxAttempts}`);
            await snapdealLogin(page, credentials);
            return true;
        } catch (err) {
            lastError = err;
            console.warn(`⚠️ Login attempt ${attempt} failed: ${err.message}`);
            if (attempt < maxAttempts) {
                await sleep(3000);
            }
        }
    }
    throw new Error(
        `Snapdeal login failed after ${maxAttempts} attempts: ${lastError ? lastError.message : "unknown error"}`
    );
}

// ---------------------------
// 🔽 Generic Snapdeal Dropdown
// ---------------------------

async function selectDropdownOption(page, refineType, optionTitle) {
    console.log(`    🔽 Dropdown [${refineType}] → selecting "${optionTitle}"`);

    const displaySelector = `dropdown[refine-type="${refineType}"] .dropdown-display[ng-click="show();"]`;
    await page.waitForSelector(displaySelector, { visible: true, timeout: 10000 });
    await page.click(displaySelector);
    await sleep(500);

    const clicked = await page.evaluate((refine, title) => {
        const dd = document.querySelector(`dropdown[refine-type="${refine}"]`);
        if (!dd) return false;
        const items = dd.querySelectorAll(".dropdown-list div[ng-repeat] span");
        for (const span of items) {
            if (span.getAttribute("title") === title) {
                span.parentElement.click();
                return true;
            }
        }
        return false;
    }, refineType, optionTitle);

    if (!clicked) {
        throw new Error(`Option "${optionTitle}" not found in dropdown [${refineType}]`);
    }
    console.log(`    ✅ Selected "${optionTitle}"`);
    await sleep(600);
}

// ---------------------------
// 📊 Reports Navigation
// ---------------------------
async function navigateToReportsTab(page) {
    console.log("📊 Navigating to Reports tab...");
    const reportsSelector = "#nav_26 a";
    await page.waitForSelector(reportsSelector, { visible: true, timeout: 10000 });
    await page.click(reportsSelector);
    await sleep(10000);
    console.log("    ✅ Reports page loaded");
}

async function openCreateReportModal(page) {
    // Anchor on Snapdeal's own Angular hook instead of brittle text matching.
    // The Reports header has two sibling buttons with class `sf-button-secondary`
    // ("Create New Report" and "View Scheduled Reports"); the ng-click attribute
    // is the only stable thing that uniquely identifies the right one.
    const BUTTON_SELECTOR =
        'button.sf-button-secondary[ng-click*="showCreateReport"]';
    const ATTEMPTS = 2;

    // Snapshot key DOM state for prod diagnostics. Cheap (one page.evaluate)
    // and answers: am I on the right page? is the button rendered? visible?
    // is something overlaying it? did a modal actually open?
    const probe = async (label) => {
        try {
            const state = await page.evaluate(() => {
                const allSecondary = Array.from(
                    document.querySelectorAll("button.sf-button-secondary")
                );
                const createBtns = allSecondary.filter((b) =>
                    (b.getAttribute("ng-click") || "").includes("showCreateReport")
                );
                const overlays = Array.from(
                    document.querySelectorAll(
                        '.sf-modal-dialog-wrapper, [class*="overlay"], [class*="tooltip"], [class*="interstitial"], [class*="banner"]'
                    )
                )
                    .slice(0, 5)
                    .map((el) => ({
                        cls: (el.className || "").toString().slice(0, 120),
                        visible: !!(el.offsetWidth || el.offsetHeight),
                    }));
                const modalHeaders = Array.from(
                    document.querySelectorAll(".sf-modal-header")
                ).map((el) => (el.textContent || "").trim());
                return {
                    url: location.href,
                    title: document.title,
                    readyState: document.readyState,
                    bodyTextLen: ((document.body && document.body.innerText) || "").length,
                    hasReportContainer: !!document.querySelector(
                        ".report-data, [report-controller]"
                    ),
                    secondaryBtnCount: allSecondary.length,
                    createBtnCount: createBtns.length,
                    createBtns: createBtns.map((b) => {
                        const r = b.getBoundingClientRect();
                        const cs = window.getComputedStyle(b);
                        return {
                            text: (b.textContent || "").trim().slice(0, 80),
                            rect: {
                                x: Math.round(r.x),
                                y: Math.round(r.y),
                                w: Math.round(r.width),
                                h: Math.round(r.height),
                            },
                            display: cs.display,
                            visibility: cs.visibility,
                            pointerEvents: cs.pointerEvents,
                            disabled: b.disabled,
                        };
                    }),
                    overlays,
                    modalHeaders,
                    viewport: {
                        w: window.innerWidth,
                        h: window.innerHeight,
                    },
                };
            });
            console.log(
                `🔍 [openCreateReportModal:${label}] ${JSON.stringify(state)}`
            );
        } catch (probeErr) {
            console.warn(
                `⚠️ probe[${label}] failed: ${probeErr.message}`
            );
        }
    };

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        console.log(
            `🆕 Clicking 'Create New Report' button (attempt ${attempt}/${ATTEMPTS})...`
        );
        try {
            await probe(`attempt-${attempt}-before-wait`);

            const createBtn = await page.waitForSelector(BUTTON_SELECTOR, {
                visible: true,
                timeout: 30000,
            });

            // Bring the button into view so an overlay/banner above can't
            // silently swallow the click on slower prod paints.
            await createBtn.evaluate((el) =>
                el.scrollIntoView({ block: "center" })
            );
            await sleep(300);

            await probe(`attempt-${attempt}-before-click`);

            // Invoke the element's own .click() inside the page context so
            // Angular's ng-click handler fires through the standard dispatch
            // path — avoids the CDP synthetic-mouse-event race we suspect on
            // prod Chrome builds.
            await page.$eval(BUTTON_SELECTOR, (btn) => btn.click());

            // Short settle, then probe to confirm the modal actually opened
            // (or capture what showed up instead). Total post-click wait is
            // still ~10s as before.
            await sleep(2000);
            await probe(`attempt-${attempt}-after-click`);
            await sleep(8000);
            console.log("    ✅ Generate Report modal opened");
            return;
        } catch (err) {
            console.warn(
                `⚠️ 'Create New Report' click failed on attempt ${attempt}: ${err.message}`
            );
            await probe(`attempt-${attempt}-on-failure`);
            if (attempt === ATTEMPTS) {
                throw err;
            }
            // Reload the page and go back to the Reports tab before retrying.
            console.log("🔄 Reloading page and re-opening Reports tab before retry...");
            try {
                await page.reload({
                    waitUntil: "domcontentloaded",
                    timeout: 20000,
                });
                await sleep(3000);
                await navigateToReportsTab(page);
                await sleep(2000);
            } catch (reloadErr) {
                console.warn(
                    `⚠️ Reload before retry failed: ${reloadErr.message}`
                );
            }
        }
    }
}

// ---------------------------
// 📆 Date Range Picker
// ---------------------------
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

/**
 * Read the currently displayed year/month from a picker's title 
 */
async function readPickerViewMonth(page, pickerAttr) {
    return page.evaluate((attr) => {
        const picker = document.querySelector(`div[date-picker="${attr}"]`);
        if (!picker) return null;
        const title = picker.querySelector(".dp-title");
        if (!title) return null;
        const parts = title.textContent.trim().split(/\s+/);
        const year = parseInt(parts[0], 10);
        const monthName = parts[1];
        const months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ];
        const month = months.indexOf(monthName);
        if (month === -1 || Number.isNaN(year)) return null;
        return { year, month };
    }, pickerAttr);
}

/**
 * Click left/right arrow of a picker until its view matches the target 
 */
async function navigatePickerToMonth(page, pickerAttr, targetYear, targetMonth) {
    console.log(
        `    📆 [${pickerAttr}] navigating to ${targetYear}-${String(targetMonth + 1).padStart(2, "0")} (${MONTH_NAMES[targetMonth]})`
    );

    for (let safety = 0; safety < 240; safety++) {
        const current = await readPickerViewMonth(page, pickerAttr);
        if (!current) throw new Error(`Could not read view month for picker "${pickerAttr}"`);

        const currentIdx = current.year * 12 + current.month;
        const targetIdx = targetYear * 12 + targetMonth;
        if (currentIdx === targetIdx) return;

        const direction = targetIdx > currentIdx ? "right" : "left";
        const arrowSelector = `div[date-picker="${pickerAttr}"] .date-header .${direction}-arrow`;

        const arrowState = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (!el) return { found: false };
            return {
                found: true,
                disabled: el.classList.contains("disable-arrow"),
            };
        }, arrowSelector);

        if (!arrowState.found) throw new Error(`Arrow ${direction} not found for picker "${pickerAttr}"`);
        if (arrowState.disabled) {
            throw new Error(
                `Cannot navigate ${direction} in picker "${pickerAttr}" — arrow disabled at ${current.year} ${MONTH_NAMES[current.month]}`
            );
        }

        await page.click(arrowSelector);
        await sleep(150);
    }
    throw new Error(`Month navigation safety limit hit for picker "${pickerAttr}"`);
}

/**
 * Click a specific day number inside a picker.  
 */
async function clickDayInPicker(page, pickerAttr, day) {
    const clicked = await page.evaluate((attr, targetDay) => {
        const picker = document.querySelector(`div[date-picker="${attr}"]`);
        if (!picker) return { ok: false, reason: "picker not found" };
        const cells = picker.querySelectorAll(".dp-cell.date-cell");
        for (const cell of cells) {
            if (cell.classList.contains("disabled")) continue;
            if (parseInt(cell.textContent.trim(), 10) === targetDay) {
                cell.click();
                return { ok: true };
            }
        }
        return { ok: false, reason: `day ${targetDay} not clickable (disabled or missing)` };
    }, pickerAttr, day);

    if (!clicked.ok) {
        throw new Error(`Picker "${pickerAttr}": ${clicked.reason}`);
    }
    console.log(`    ✅ [${pickerAttr}] clicked day ${day}`);
    await sleep(400);
}

/**
 * Select a start + end date on the Generate Report date range picker. 
 */
async function selectDateRange(page, startDate, endDate) {
    console.log(
        `📆 Selecting date range: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`
    );

    // Start picker
    await navigatePickerToMonth(page, "start", startDate.getFullYear(), startDate.getMonth());
    await clickDayInPicker(page, "start", startDate.getDate());

    // End picker — navigate AFTER start is selected, because selecting
    // start can shift the end picker's allowed range.
    await navigatePickerToMonth(page, "end", endDate.getFullYear(), endDate.getMonth());
    await clickDayInPicker(page, "end", endDate.getDate());

    console.log("    ✅ Date range selected");
}

/**
 * Click the Apply button in the date-range popover 
 */
async function clickApplyDateRange(page) {
    console.log("✅ Clicking 'Apply' on date range...");
    const applyBtn = await page.waitForSelector(
        '::-p-text(Apply)',
        { visible: true, timeout: 10000 }
    );
    await applyBtn.click();
    const requestedAt = new Date();
    await sleep(500);
    console.log(`    ✅ Apply clicked at ${requestedAt.toISOString()}`);
    return requestedAt;
}

/**
 * Find the report-card that matches our just-submitted request.
 */
async function findReportCardByRequestTime(page, { reportName, requestedAt, toleranceMinutes = 2 }) {
    const cards = await page.evaluate(() => {
        const out = [];
        const nodes = document.querySelectorAll(".report-data .report-card");
        for (const card of nodes) {
            const nameEl = card.querySelector(".report-name");
            const initEl = card.querySelector(".initiation-time");
            const statusEl = card.querySelector(".status-completed");
            const downloadEl = card.querySelector("a.report-download");
            out.push({
                name: nameEl ? nameEl.getAttribute("title") || nameEl.textContent.trim() : null,
                initiationText: initEl ? initEl.textContent.trim() : null,
                status: statusEl ? "CMP" : "PENDING",
                downloadHref: downloadEl ? downloadEl.getAttribute("href") : null,
            });
        }
        return out;
    });

    const parseInitiationTime = (text) => {
        if (!text) return null;
        const m = text.match(/Initiated on (\d{1,2}) (\w{3}) (\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (!m) return null;
        const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
        const [, d, mon, y, h, min, ampm] = m;
        const month = months[mon.toLowerCase().slice(0, 3)];
        if (month === undefined) return null;
        let hour = parseInt(h, 10);
        if (/pm/i.test(ampm) && hour !== 12) hour += 12;
        if (/am/i.test(ampm) && hour === 12) hour = 0;
        return new Date(parseInt(y, 10), month, parseInt(d, 10), hour, parseInt(min, 10));
    };

    const toleranceMs = toleranceMinutes * 60 * 1000;
    for (const card of cards) {
        if (card.name !== reportName) continue;
        const initiatedAt = parseInitiationTime(card.initiationText);
        if (!initiatedAt) continue;
        const diff = Math.abs(initiatedAt.getTime() - requestedAt.getTime());
        if (diff <= toleranceMs) {
            return { ...card, initiatedAt };
        }
    }
    return null;
}

/**
 * Click the "Generate Report" submit button in the modal footer. 
 */
async function clickGenerateReport(page) {
    console.log("📨 Clicking 'Generate Report' submit button...");
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll(".sf-modal-footer .sf-modal-btn");
        for (const btn of buttons) {
            if (btn.textContent.trim() === "Generate Report") {
                btn.click();
                return true;
            }
        }
        return false;
    });
    if (!clicked) throw new Error("Generate Report button not found in modal footer");
    const requestedAt = new Date();
    await sleep(800);
    console.log(`    ✅ Generate Report clicked at ${requestedAt.toISOString()}`);
    return requestedAt;
}

/**
 * Find a report-card by exact initiation text
 */
async function findReportCardByInitiationText(page, { reportName, initiationText }) {
    return page.evaluate((name, initText) => {
        const cards = document.querySelectorAll(".report-data .report-card");
        for (const card of cards) {
            const nameEl = card.querySelector(".report-name");
            const initEl = card.querySelector(".initiation-time");
            const statusEl = card.querySelector(".status-completed");
            const downloadEl = card.querySelector("a.report-download");

            const cardName = nameEl ? (nameEl.getAttribute("title") || nameEl.textContent.trim()) : null;
            const cardInit = initEl ? initEl.textContent.trim() : null;

            if (cardName === name && cardInit === initText) {
                return {
                    name: cardName,
                    initiationText: cardInit,
                    status: statusEl ? "CMP" : "PENDING",
                    downloadHref: downloadEl ? downloadEl.getAttribute("href") : null,
                };
            }
        }
        return null;
    }, reportName, initiationText);
}

/**
 * Trigger the Download button of a specific report-card (matched by exact initiation text).
 */
async function clickReportDownload(page, { reportName, initiationText }) {
    console.log(`⬇️  Clicking Download for "${reportName}" @ "${initiationText}"`);
    const result = await page.evaluate((name, initText) => {
        const cards = document.querySelectorAll(".report-data .report-card");
        for (const card of cards) {
            const nameEl = card.querySelector(".report-name");
            const initEl = card.querySelector(".initiation-time");
            const cardName = nameEl ? (nameEl.getAttribute("title") || nameEl.textContent.trim()) : null;
            const cardInit = initEl ? initEl.textContent.trim() : null;
            if (cardName !== name || cardInit !== initText) continue;

            const anchor = card.querySelector("a.report-download");
            if (!anchor) return { ok: false, reason: "card found but no Download link (status not CMP?)" };

            anchor.removeAttribute("target");
            anchor.click();
            return { ok: true, href: anchor.getAttribute("href") };
        }
        return { ok: false, reason: "card not found" };
    }, reportName, initiationText);

    if (!result.ok) throw new Error(`clickReportDownload: ${result.reason}`);
    console.log(`    ✅ Download click fired — href: ${result.href}`);
    return result.href;
}

async function clickChooseDateRange(page) {
    console.log("📅 Clicking 'Choose Date Range'...");
    const dateRangeBtn = await page.waitForSelector(
        "::-p-text(Choose Date Range)",
        { visible: true, timeout: 10000 }
    );
    await dateRangeBtn.click();
    await sleep(800);
    console.log("    ✅ Date range picker opened");
}

module.exports = {
    // re-exports from snapdealAutoClaim so callers only import from one place
    enableStealthMode,
    handleDialog,
    snapdealLogin,
    snapdealLoginWithRetry,

    // master-data-specific helpers
    sleep,
    selectDropdownOption,
    navigateToReportsTab,
    openCreateReportModal,
    clickChooseDateRange,
    selectDateRange,
    clickApplyDateRange,
    clickGenerateReport,
    findReportCardByRequestTime,
    findReportCardByInitiationText,
    clickReportDownload,
};
