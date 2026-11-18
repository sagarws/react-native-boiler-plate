// -----------------------------------------------------------------------------
// Meesho — close whatever promo it just put in front of the page
// -----------------------------------------------------------------------------
// Meesho interrupts the supplier panel with marketing modals ("Aage Badho!",
// Pay Later Lite, and whatever comes next). They block every click behind them,
// so an automation that cannot dismiss one stops at the first step it takes.
//
// WHY THIS IS MARKUP-AGNOSTIC. The two existing handlers each matched one
// build's markup: the claim tree looked for `Overlay__mtdbh40.Modal__1jp7csq1`,
// the master-import tree for `div[role="dialog"][aria-modal="true"]`. Meesho
// then shipped a third — Tailwind-ish `growth-` utility classes, no `role`, no
// `aria-modal`, and a close control that is an IMG inside a plain DIV:
//
//   <div class="growth-shrink-0">
//     <img src="…/merlin/lined/cross-grey.svg" width="25" height="25">
//   </div>
//
// Nothing in that is a button, so neither handler saw it. Chasing class names
// is how this repeats every time Meesho redesigns, so this matches on what a
// close control IS rather than what it is called: a cross icon, an aria-label,
// or a × glyph, inside something that sits on top of the page.
//
// Shared by both Meesho trees: the same popup interrupts the claim login and
// the master import, and two copies is what let the new one through twice.
// -----------------------------------------------------------------------------

/** Waits, in a page-agnostic way (Puppeteer dropped page.waitForTimeout). */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs IN the page: finds an overlay and clicks its close control.
 *
 * Returns what it did, so the caller can log something true rather than
 * "handled". Clicking is done here, by dispatching on the element itself, for
 * the reason the master-import handler documents: React's handler may sit on
 * the img, on its wrapper, or higher up, and a co-ordinate click can land on
 * whichever of those is not listening.
 */
const DISMISS_IN_PAGE = function () {
    const CLOSE_ICON = /cross|close|x-mark|dismiss/i;

    const visible = (el) => {
        if (!el || !el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };

    /** Something drawn over the page: a dialog, or a fixed/absolute box near the top of the stack. */
    const overlays = () => {
        const found = [];
        const byRole = document.querySelectorAll('div[role="dialog"], [aria-modal="true"]');

        for (const el of byRole) if (visible(el)) found.push(el);

        // The `growth-` build is neither, so fall back to what an overlay
        // always is: a positioned element with a real z-index covering a good
        // part of the viewport.
        for (const el of document.querySelectorAll("div")) {
            if (found.includes(el) || !visible(el)) continue;

            const style = window.getComputedStyle(el);
            if (style.position !== "fixed" && style.position !== "absolute") continue;

            const z = Number.parseInt(style.zIndex, 10);
            if (!Number.isFinite(z) || z < 1) continue;

            const rect = el.getBoundingClientRect();
            const coversMuch =
                rect.width > window.innerWidth * 0.3 && rect.height > window.innerHeight * 0.25;

            if (coversMuch) found.push(el);
        }

        return found;
    };

    /** The close control inside one overlay, by what it is rather than its class. */
    const closeControl = (root) => {
        const labelled = root.querySelector(
            '[aria-label*="close" i], [aria-label*="dismiss" i], [data-testid*="close" i], button[title*="close" i]'
        );

        if (labelled && visible(labelled)) return labelled;

        for (const img of root.querySelectorAll("img")) {
            const src = img.getAttribute("src") || "";
            const alt = img.getAttribute("alt") || "";

            if (!CLOSE_ICON.test(src) && !CLOSE_ICON.test(alt)) continue;
            if (!visible(img)) continue;

            // The click handler is usually on the wrapper, not the image.
            return img.closest("button, [role='button'], div") || img;
        }

        for (const el of root.querySelectorAll("button, span, div")) {
            const text = (el.textContent || "").trim();

            if ((text === "×" || text === "✕" || text === "X") && visible(el)) return el;
        }

        return null;
    };

    const candidates = overlays();

    if (candidates.length === 0) return { found: false, closed: false, how: "none" };

    for (const overlay of candidates) {
        const control = closeControl(overlay);

        if (!control) continue;

        // Click the control AND its ancestors up to the overlay: the listener
        // may be on any of them, and clicking a child that is not listening is
        // indistinguishable from not clicking at all.
        let node = control;

        for (let depth = 0; node && node !== overlay && depth < 4; depth += 1) {
            node.click();
            node = node.parentElement;
        }

        return { found: true, closed: true, how: "close-control" };
    }

    return { found: true, closed: false, how: "no-control" };
};

/** Is anything still covering the page? Same test as above, without clicking. */
const STILL_OPEN_IN_PAGE = function () {
    const visible = (el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
    };

    for (const el of document.querySelectorAll('div[role="dialog"], [aria-modal="true"]')) {
        if (visible(el)) return true;
    }

    for (const el of document.querySelectorAll("div")) {
        const style = window.getComputedStyle(el);
        if (style.position !== "fixed" && style.position !== "absolute") continue;

        const z = Number.parseInt(style.zIndex, 10);
        if (!Number.isFinite(z) || z < 1) continue;
        if (!visible(el)) continue;

        const rect = el.getBoundingClientRect();
        if (rect.width > window.innerWidth * 0.3 && rect.height > window.innerHeight * 0.25) {
            return true;
        }
    }

    return false;
};

/**
 * Close any Meesho promo modal standing in front of the page.
 *
 * Never throws: a popup that cannot be closed must not end the run before the
 * step that would have reported something useful. Returns whether the page is
 * clear, so a caller that genuinely cannot proceed can say so.
 *
 * @param {object} page  a Puppeteer page
 * @param {{ attempts?: number, settleMs?: number, log?: object }} [options]
 * @returns {Promise<{ found: boolean, closed: boolean }>}
 */
async function dismissMeeshoPopup(page, { attempts = 3, settleMs = 1200, log = console } = {}) {
    let found = false;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        let result;

        try {
            result = await page.evaluate(DISMISS_IN_PAGE);
        } catch (err) {
            (log.warn || log.log).call(log, `⚠️ popup check failed: ${err.message}`);

            return { found, closed: false };
        }

        if (!result.found) return { found, closed: true };

        found = true;

        if (result.how === "no-control") {
            // Nothing clickable in it. Removing the node is the last resort —
            // it unblocks the page, and the popup is marketing, not state.
            await page.evaluate(STILL_OPEN_IN_PAGE);
            (log.log || log.info).call(log, "📢 Meesho popup has no close control — removing it");

            try {
                await page.evaluate(function () {
                    for (const el of document.querySelectorAll('div[role="dialog"], [aria-modal="true"]')) {
                        el.remove();
                    }
                });
            } catch (err) {
                (log.warn || log.log).call(log, `⚠️ could not remove the popup: ${err.message}`);
            }
        } else {
            (log.log || log.info).call(log, `📢 Meesho popup detected — closed (attempt ${attempt})`);
        }

        await wait(settleMs);

        const stillOpen = await page.evaluate(STILL_OPEN_IN_PAGE).catch(() => false);

        // Meesho sometimes queues a second promo behind the first, so this
        // loops rather than returning on the first success.
        if (!stillOpen) return { found, closed: true };
    }

    return { found, closed: false };
}

module.exports = { dismissMeeshoPopup, DISMISS_IN_PAGE, STILL_OPEN_IN_PAGE };
