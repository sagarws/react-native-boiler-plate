const path = require("path");
const fs = require("fs-extra");
const logger = require("../../../../common/redactingLogger");
// Moved to platforms/meesho/common/ when the claim login turned out to need
// them too. Re-exported here so this flow's callers and the package barrels
// are unchanged.
const { enableStealthMode, handleDialog } = require("../../common/browserHelpers");

const TEMP_FILE_PATH = path.join(__dirname, "..", "tempFiles");
fs.ensureDirSync(TEMP_FILE_PATH);

let cleanupInProgress = false;

/**
 * Remove all files from the meesho tempFiles directory.
 * Idempotent — guarded against re-entry.
 */
async function cleanupTempFiles() {
    if (cleanupInProgress) return;
    cleanupInProgress = true;

    logger.info("🧹 Starting temp files cleanup...");

    try {
        if (fs.existsSync(TEMP_FILE_PATH)) {
            const files = fs.readdirSync(TEMP_FILE_PATH);
            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(TEMP_FILE_PATH, file);
                try {
                    fs.removeSync(filePath);
                    deletedCount++;
                } catch (err) {
                    logger.warn(`⚠️ Could not delete temp file: ${file}`);
                }
            }

            logger.info(`✅ Deleted ${deletedCount} temp files from ${TEMP_FILE_PATH}`);
        }
    } catch (err) {
        logger.error({ err }, "❌ Error during temp files cleanup");
    } finally {
        cleanupInProgress = false;
    }
}

/**
 * Register SIGINT/SIGTERM handlers so temp files are cleaned even on Ctrl+C.
 * Safe to call multiple times — only attaches once.
 */
let interruptHandlersAttached = false;
function setupCleanupOnInterrupt() {
    if (interruptHandlersAttached) return;
    interruptHandlersAttached = true;

    const cleanup = async () => {
        logger.warn("⚠️ Script interrupted! Cleaning temp files before exit...");
        await cleanupTempFiles();
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
}


function removeOrphanFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
        fs.unlinkSync(filePath);
        logger.info(`🧹 Removed orphan file: ${path.basename(filePath)}`);
    } catch (unlinkErr) {
        logger.warn(`⚠️ Failed to remove orphan file: ${unlinkErr.message}`);
    }
}

/**
 * Close the post-login advertisement popup if it appears.
 */
async function handleAdvertisementPopup(page) {
    try {
        logger.info("🔍 Checking for advertisement popup...");

        // Give the SPA a moment to mount the popup after dashboard load.
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Poll briefly for the modal — sometimes it appears a beat after
        // the dashboard does.
        let modalDetected = false;
        const POLL_TIMEOUT_MS = 5000;
        const startedAt = Date.now();
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
            modalDetected = await page.evaluate(() => {
                return Boolean(
                    document.querySelector('div[role="dialog"][aria-modal="true"]')
                );
            });
            if (modalDetected) break;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!modalDetected) {
            // NOT the end of it. Meesho's newer promos ("Aage Badho!", Pay
            // Later Lite) carry no role and no aria-modal, so the poll above
            // cannot see them at all — they close through an
            // <img src="…cross-grey.svg"> inside a plain <div>. The shared
            // dismissal matches on what a close control IS rather than what it
            // is called; see platforms/meesho/common/dismissPopup.js.
            const { dismissMeeshoPopup } = require("../../common/dismissPopup");
            const result = await dismissMeeshoPopup(page, { log: logger });

            if (!result.found) logger.info("✅ No advertisement popup detected");
            else if (result.closed) logger.info("✅ Advertisement popup closed");
            else logger.warn("⚠️ A Meesho popup is still on screen — the next click may not land");

            return;
        }

        logger.info("📢 Advertisement popup detected — closing it");

        // Helper — wait for the dialog to actually disappear (React click
        // handler may sit on the img, its wrapper, or higher; we need to
        // *verify* the close, not just trust the click landed somewhere).
        const dialogIsGone = async (timeoutMs = 2000) => {
            try {
                await page.waitForFunction(
                    () => !document.querySelector('div[role="dialog"][aria-modal="true"]'),
                    { timeout: timeoutMs, polling: 200 }
                );
                return true;
            } catch {
                return false;
            }
        };

        // Build a list of candidate elements to click, in priority order:

        const candidateHandles = await page.evaluateHandle(() => {
            const results = [];
            const dialog = document.querySelector('div[role="dialog"][aria-modal="true"]');
            if (!dialog) return results;

            const crossImg = Array.from(dialog.querySelectorAll("img")).find((img) =>
                (img.getAttribute("src") || "").includes("cross-grey")
            );
            if (crossImg) {
                let node = crossImg;
                // img + up to 4 ancestors, stopping at the dialog
                for (let i = 0; i < 5 && node && node !== dialog; i++) {
                    results.push(node);
                    node = node.parentElement;
                }
            }

            const ariaCloser = dialog.querySelector('[aria-label*="lose" i], [aria-label*="dismiss" i]');
            if (ariaCloser) results.push(ariaCloser);

            const overlay = document.querySelector('div[role="presentation"][aria-label="Close modal"]');
            if (overlay) results.push(overlay);

            return results;
        });

        const candidateProps = await candidateHandles.getProperties();
        const candidates = Array.from(candidateProps.values()).filter((h) => h.asElement());

        let closedVia = null;
        for (let i = 0; i < candidates.length; i++) {
            const handle = candidates[i].asElement();
            try {
                // Real puppeteer click → dispatches mousedown/mouseup/click
                // at the element's center; React picks this up reliably.
                await handle.click({ delay: 30 });
            } catch (clickErr) {
                logger.warn(`⚠️ Click attempt ${i + 1} threw: ${clickErr.message}`);
                continue;
            }

            if (await dialogIsGone(1500)) {
                closedVia = i === candidates.length - 1 ? "overlay" : `candidate-${i + 1}`;
                break;
            }
        }

        // Free the JSHandle either way
        await candidateHandles.dispose();

        if (!closedVia) {
            // Last-resort: press Escape — many MUI/Meesho dialogs honor it.
            logger.warn("⚠️ All click candidates failed — trying Escape key");
            await page.keyboard.press("Escape");
            if (await dialogIsGone(1500)) {
                closedVia = "escape-key";
            }
        }

        if (!closedVia) {
            logger.warn("⚠️ Advertisement popup still visible after all close attempts");
            return;
        }

        logger.info(`✅ Advertisement popup closed (via ${closedVia})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
        logger.warn(`⚠️ Error while handling advertisement popup: ${error.message}`);
    }
}

module.exports = {
    TEMP_FILE_PATH,
    cleanupTempFiles,
    setupCleanupOnInterrupt,
    removeOrphanFile,
    enableStealthMode,
    handleDialog,
    handleAdvertisementPopup,
};
