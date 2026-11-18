/**
 * AJIO report download by driving the Reports page — View → Export → wait.
 *
 * This is the half that distinguishes the script flow from the API flow. Both
 * share `../common/reportPage` to set the page up; only the fetch differs:
 *
 *   script flow (here)  — click View, click Export, watch for the file
 *   api flow            — POST the download endpoint from inside the page
 *
 * The API flow replaced this in July 2026 because AJIO's "Seller Central"
 * revamp kept breaking the sidebar and dropdown selectors. It is kept as a
 * genuine second flow so `apiBasedAutomation.ajio.masterImport = false` means
 * something, and because a portal change that breaks one fetch rarely breaks
 * the other.
 *
 * `downloadPath` is a parameter rather than a module constant: the server
 * downloads into its own tempFiles/, the desktop app into a per-run temp
 * directory it deletes afterwards.
 */

const fs = require("fs-extra");

const { setDateRange } = require("../common/reportPage");

// Helper function to wait for file download dynamically
// Large enterprise accounts (e.g. arvindfashions) have big exports that can take
// several minutes to generate before the file lands — allow up to 5 minutes.
const waitForDownload = async (downloadPath, timeout = 300000) => {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const initialFiles = new Set(fs.readdirSync(downloadPath));

        const interval = setInterval(() => {
            const currentFiles = new Set(fs.readdirSync(downloadPath));
            const newFiles = [...currentFiles].filter(f => !initialFiles.has(f) && (f.endsWith(".csv") || f.endsWith(".xlsx")));

            if (newFiles.length > 0) {
                clearInterval(interval);
                resolve(newFiles[0]);
            }

            if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                reject(new Error(`⏳ Download timeout exceeded (${timeout / 1000}s)`));
            }
        }, 1000);
    });
};

/**
 * Download ONE date-chunk's report: set dates → click View (with retry on AJIO's
 * intermittent server-side "Request Timed out") → click Export → wait for the file.
 *
 * Shared by the production runScript AND the local test harness so both exercise
 * the exact same View-retry + download logic. Does NOT upload — the caller decides
 * what to do with the downloaded file (prod uploads to TrackVid; test keeps it).
 *
 * @returns {Promise<string|null>} the downloaded filename, or null if the chunk has no data.
 * @throws if AJIO's report generation keeps timing out after MAX_VIEW_RETRIES.
 */
async function downloadReportChunk(page, client, chunk, userLogger, { downloadPath } = {}) {
    if (!downloadPath) {
        throw new Error("downloadReportChunk: downloadPath is required — the caller owns the temp directory");
    }

    // Set date range for this chunk
    await setDateRange(page, chunk.fromDate, chunk.toDate);
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Set download behavior
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath
    });

    // Click 'View' with retry. AJIO's report generation intermittently returns
    // "Request Timed out" (server-side, regardless of range size). It generates
    // async, so retrying View after a back-off usually gets the now-ready report.
    const viewButtonSelector = "button.MuiButton-containedPrimary";
    const MAX_VIEW_RETRIES = 4;
    let exportButtonHandle = null;
    let exportButtonIsValid = false;
    let lastTimedOut = false;

    for (let vAttempt = 1; vAttempt <= MAX_VIEW_RETRIES; vAttempt++) {
        userLogger.debug(`🔍 Clicking the 'View' button (attempt ${vAttempt}/${MAX_VIEW_RETRIES})...`);
        await page.waitForSelector(viewButtonSelector, { visible: true, timeout: 10000 });
        await page.evaluate((selector) => {
            document.querySelector(selector).scrollIntoView();
        }, viewButtonSelector);
        await page.click(viewButtonSelector);
        await new Promise(resolve => setTimeout(resolve, 4000));

        lastTimedOut = await page.evaluate(() => {
            const t = document.body.innerText || "";
            return t.includes("Request Timed out") || t.includes("is not valid JSON");
        });
        if (lastTimedOut) {
            const backoff = 5000 * vAttempt;
            userLogger.warn(`⏳ AJIO "Request Timed out" (attempt ${vAttempt}/${MAX_VIEW_RETRIES}). Retrying in ${backoff / 1000}s...`);
            await page.evaluate(() => {
                const btn = document.querySelector('[role="alert"] button, .notistack-Snackbar button, .MuiSnackbar-root button');
                if (btn) btn.click();
            }).catch(() => { });
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
        }

        exportButtonHandle = await page.evaluateHandle(() => {
            return Array.from(document.querySelectorAll("button"))
                .find(btn => btn.innerText && btn.innerText.trim().includes("Export"));
        });
        exportButtonIsValid = exportButtonHandle && typeof exportButtonHandle.asElement === 'function' && exportButtonHandle.asElement();
        // Page responded WITHOUT an AJIO timeout → result is definitive:
        // Export present = data to download; absent = genuine "no data".
        // Either way stop — only the timeout path above warrants a retry.
        break;
    }

    if (!exportButtonIsValid) {
        // Persistent AJIO timeout = a real failure (caller counts it as an error).
        if (lastTimedOut) {
            throw new Error(`AJIO report generation timed out for ${chunk.fromDate} → ${chunk.toDate} after ${MAX_VIEW_RETRIES} attempts`);
        }
        return null; // genuine no-data for this chunk
    }

    userLogger.debug("✅ 'Export' button found, proceeding to download...");
    await exportButtonHandle.evaluate(button => {
        button.scrollIntoView({ behavior: "smooth", block: "center" });
        button.focus();
        button.click();
    });

    userLogger.info("⏳ Waiting for the report to be downloaded...");
    const downloadedFile = await waitForDownload(downloadPath);
    userLogger.info(`✅ Downloaded file: ${downloadedFile}`);
    return downloadedFile;
}

module.exports = {
    waitForDownload,
    downloadReportChunk,
};
