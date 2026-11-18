/**
 * AJIO Reports page — the UI navigation both master-import flows share.
 *
 * AJIO's two flows differ ONLY in how the report is fetched once the page is
 * set up: the API flow calls the download endpoint from inside the logged-in
 * page, the script flow clicks View → Export and watches for the file. Getting
 * to that point — opening the Place-of-Business selector, selecting every PoB,
 * setting the dates, splitting a long range into portal-sized chunks — is
 * identical, so it lives here rather than being duplicated per flow.
 *
 * Lifted out of the automation server's script.js so the CMS desktop runner
 * uses the same navigation; a copy in each consumer drifts the first time AJIO
 * moves a button.
 */

const dayjs = require("dayjs");

// ---- Enterprise Place-of-Business allowlist ----
// Some enterprise AJIO accounts render PoB as a "Change" button + modal
// ("Select Place of Business") instead of the normal MUI dropdown. The emails
// listed in ENTERPRISE_POB_EMAILS use that modal flow. To onboard a new
// enterprise client with the same UI, just add their AJIO email to .env.
const ENTERPRISE_POB_EMAILS = (process.env.ENTERPRISE_POB_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

const isEnterprisePoBUser = (username) =>
    !!username && ENTERPRISE_POB_EMAILS.includes(username.trim().toLowerCase());

async function openPoBDropdown(page) {
    await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll('label'));
        const pobLabel = labels.find(l =>
            l.innerText.trim().toLowerCase().includes('place of business')
        );
        if (pobLabel) {
            const parent = pobLabel.closest('.MuiFormControl-root');
            if (parent) {
                const combo = parent.querySelector('[role="combobox"]');
                if (combo) {
                    // MUI Select listens to mousedown, not click
                    combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                }
            }
        }
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.waitForSelector('ul[role="listbox"] li', { visible: true, timeout: 10000 });
}

/**
 * Close the Place of Business dropdown.
 */
async function closePoBDropdown(page) {
    // Press Escape to close any open MUI dropdown — more reliable than re-clicking
    await page.keyboard.press('Escape');
    await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * Select all brands via the "Select All" checkbox.
 */
async function selectAllBrands(page, userLogger) {
    await openPoBDropdown(page);

    const brandOptions = await page.$$eval('ul[role="listbox"] li', items =>
        items.map(el => el.innerText.trim())
    );

    if (brandOptions.some(text => text.includes("Select All"))) {
        userLogger.debug("🧾 Multiple brands found. Clicking 'Select All'...");
        await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('ul[role="listbox"] li'));
            const selectAll = items.find(el => el.innerText.includes("Select All"));
            if (selectAll) {
                const checkbox = selectAll.querySelector('input[type="checkbox"]');
                if (checkbox && !checkbox.checked) {
                    checkbox.click();
                }
            }
        });
        userLogger.debug("✅ 'Select All' clicked.");
    } else {
        userLogger.debug("✅ Only one brand present. Already selected.");
    }

    await closePoBDropdown(page);
}

/**
 * Enterprise PoB flow: select all Places of Business via the "Change" button + modal.
 *
 * Used only for accounts in ENTERPRISE_POB_EMAILS. Their Reports page shows a
 * "Change" button next to Place of Business that opens a "Select Place of Business"
 * modal with a "Select all the POBs" checkbox and a "Confirm" button — instead of
 * the normal MUI dropdown handled by selectAllBrands().
 *
 * Steps: click "Change" → wait modal → check "Select all the POBs" (ensure it ends
 * fully checked, handling the indeterminate/partial state) → click "Confirm" → wait close.
 */
async function selectAllPOBsViaModal(page, userLogger) {
    userLogger.debug("🏢 [Enterprise PoB] Opening 'Change' modal for Place of Business...");

    // 1. Click the "Change" button next to Place of Business
    const changeClicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button"));
        const changeBtn = btns.find(
            (b) => b.innerText && b.innerText.trim().toLowerCase() === "change"
        );
        if (changeBtn) {
            changeBtn.scrollIntoView({ block: "center" });
            changeBtn.click();
            return true;
        }
        return false;
    });
    if (!changeClicked) {
        throw new Error("Enterprise PoB: 'Change' button not found on Reports page");
    }

    // 2. Wait for the "Select Place of Business" modal
    await page.waitForSelector('div[role="dialog"]', { visible: true, timeout: 10000 });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const isPoBModal = await page.evaluate(() => {
        const dlg = document.querySelector('div[role="dialog"]');
        return !!dlg && dlg.innerText.toLowerCase().includes("place of business");
    });
    if (!isPoBModal) {
        throw new Error("Enterprise PoB: 'Select Place of Business' modal did not open");
    }
    userLogger.debug("✅ [Enterprise PoB] Modal opened.");

    // 3. Click "Select all the POBs". The checkbox carries value="selectAll" (the
    //    per-POB checkboxes use the POB code, e.g. value="DV00352054"), so we target
    //    it directly. Click once, then verify — re-click only if it didn't end fully
    //    checked. Avoids a synchronous double-click that could toggle it off before
    //    React updates state. "fully checked" = checked && not indeterminate.
    const SELECT_ALL = 'div[role="dialog"] input[type="checkbox"][value="selectAll"]';

    const clickSelectAll = async () => {
        return await page.evaluate((sel) => {
            // Primary: the value="selectAll" checkbox. Fallback: first checkbox in modal.
            let checkbox = document.querySelector(sel);
            if (!checkbox) {
                const dlg = document.querySelector('div[role="dialog"]');
                checkbox = dlg && dlg.querySelector('input[type="checkbox"]');
            }
            if (!checkbox) return { found: false };
            const isFullyChecked =
                checkbox.checked &&
                !checkbox.indeterminate &&
                checkbox.getAttribute("data-indeterminate") !== "true";
            if (!isFullyChecked) checkbox.click();
            return { found: true };
        }, SELECT_ALL);
    };

    const readSelectAllChecked = async () => {
        return await page.evaluate((sel) => {
            let checkbox = document.querySelector(sel);
            if (!checkbox) {
                const dlg = document.querySelector('div[role="dialog"]');
                checkbox = dlg && dlg.querySelector('input[type="checkbox"]');
            }
            if (!checkbox) return null;
            return {
                checked: checkbox.checked,
                indeterminate:
                    checkbox.indeterminate ||
                    checkbox.getAttribute("data-indeterminate") === "true",
            };
        }, SELECT_ALL);
    };

    const first = await clickSelectAll();
    if (!first.found) {
        throw new Error("Enterprise PoB: 'Select all the POBs' checkbox not found in modal");
    }
    await new Promise((resolve) => setTimeout(resolve, 800));

    let state = await readSelectAllChecked();
    if (!state || (!state.checked || state.indeterminate)) {
        // Not fully selected yet — click once more and re-verify.
        await clickSelectAll();
        await new Promise((resolve) => setTimeout(resolve, 800));
        state = await readSelectAllChecked();
    }
    if (!state || !state.checked || state.indeterminate) {
        throw new Error("Enterprise PoB: could not fully check 'Select all the POBs'");
    }
    userLogger.debug("✅ [Enterprise PoB] 'Select all the POBs' is fully checked.");

    // 4. Click "Confirm"
    const confirmClicked = await page.evaluate(() => {
        const dlg = document.querySelector('div[role="dialog"]');
        if (!dlg) return false;
        const btn = Array.from(dlg.querySelectorAll("button")).find(
            (b) => b.innerText && b.innerText.trim().toLowerCase() === "confirm"
        );
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    });
    if (!confirmClicked) {
        throw new Error("Enterprise PoB: 'Confirm' button not found in modal");
    }

    // 5. Wait for the modal to close
    await page
        .waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 10000 })
        .catch(() => { /* modal may linger briefly; continue */ });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    userLogger.info("✅ [Enterprise PoB] All POBs selected and confirmed.");
}

/**
 * Set the From and To date inputs on the report page.
 */
async function setDateRange(page, fromDate, toDate) {
    await page.evaluate((fromDate, toDate) => {
        let dateInputs = document.querySelectorAll("input[type='date']");
        if (dateInputs.length >= 2) {
            let nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeInputSetter.call(dateInputs[0], fromDate);
            dateInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
            dateInputs[0].dispatchEvent(new Event("change", { bubbles: true }));
            nativeInputSetter.call(dateInputs[1], toDate);
            dateInputs[1].dispatchEvent(new Event("input", { bubbles: true }));
            dateInputs[1].dispatchEvent(new Event("change", { bubbles: true }));
        }
    }, fromDate, toDate);
}

/**
 * Split a date range into chunks of max `maxDays` days each.
 * Works backwards from toDate so the most recent chunk is always full-sized.
 * Returns chunks in chronological order (oldest first).
 */
function splitDateRange(fromDate, toDate, maxDays = 29) {
    const chunks = [];
    let end = dayjs(toDate);
    const start = dayjs(fromDate);

    while (end.diff(start, 'day') >= 0) {
        let chunkStart = end.subtract(maxDays - 1, "day");
        if (chunkStart.isBefore(start)) {
            chunkStart = start;
        }
        chunks.push({
            fromDate: chunkStart.format("YYYY-MM-DD"),
            toDate: end.format("YYYY-MM-DD"),
        });
        end = chunkStart.subtract(1, "day");
    }

    return chunks.reverse(); // oldest first
}

// Helper function to wait for file download dynamically
// Large enterprise accounts (e.g. arvindfashions) have big exports that can take
// several minutes to generate before the file lands — allow up to 5 minutes.

module.exports = {
    ENTERPRISE_POB_EMAILS,
    isEnterprisePoBUser,
    openPoBDropdown,
    closePoBDropdown,
    selectAllBrands,
    selectAllPOBsViaModal,
    setDateRange,
    splitDateRange,
};
