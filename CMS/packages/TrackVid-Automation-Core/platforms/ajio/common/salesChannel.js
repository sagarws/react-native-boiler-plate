// -----------------------------------------------------------------------------
// AJIO — the "Select a sales channel" picker after sign-in
// -----------------------------------------------------------------------------
// Some Reliance Seller Central accounts sell on more than one channel. After
// the one-time code is accepted they are shown a card —
//
//   <p>Select a sales channel</p>
//   <ul> <div role="button"> <img alt="AJIO"> AJIO </div>
//        <div role="button"> <img alt="ZIVAME"> ZIVAME </div> </ul>
//
// — and nothing proceeds until one is picked. Every automation here is an
// AJIO automation, so the answer is always AJIO.
//
// Matched by the heading text and the option's own label/alt, never by the
// MUI class hashes (`mui-m0n9b3`), which change with every rebuild.
// -----------------------------------------------------------------------------

const HEADING = "select a sales channel";
const CHANNEL = "AJIO";

/**
 * One look at the page: click AJIO if the picker is up.
 *
 * @returns {Promise<"clicked"|"absent"|"no-option">} never throws
 */
async function clickAjioSalesChannel(page) {
    return page
        .evaluate(
            (heading, channel) => {
                const visible = (el) => {
                    const r = el.getBoundingClientRect();
                    const s = window.getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
                };
                const norm = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();

                const shown = Array.from(document.querySelectorAll("p, h1, h2, h3, h4, h5, h6, span, div"))
                    .some((el) => el.children.length === 0 && visible(el) && norm(el.textContent) === heading);

                if (!shown) return "absent";

                const option = Array.from(
                    document.querySelectorAll('[role="button"], .MuiListItemButton-root, li, button')
                ).find(
                    (el) =>
                        visible(el) &&
                        (norm(el.textContent) === channel.toLowerCase() ||
                            Boolean(el.querySelector(`img[alt="${channel}" i]`)))
                );

                if (!option) return "no-option";

                option.click();
                return "clicked";
            },
            HEADING,
            CHANNEL
        )
        .catch(() => "absent");
}

/**
 * Wait briefly for the picker and answer it when it appears.
 *
 * A near no-op for an account without one: it returns as soon as
 * `detectWaitMs` passes with no picker. Never throws.
 *
 * @param {object} page a Puppeteer page
 * @param {{ detectWaitMs?: number, pollMs?: number, logger?: object }} [options]
 * @returns {Promise<boolean>} true when AJIO was picked
 */
async function pickAjioSalesChannelIfShown(page, { detectWaitMs = 8000, pollMs = 400, logger = console } = {}) {
    const deadline = Date.now() + detectWaitMs;
    let picked = false;

    while (Date.now() < deadline) {
        const state = await clickAjioSalesChannel(page);

        if (state === "clicked") {
            picked = true;
            logger.info?.("   🏬 Picked the AJIO sales channel");
            // Let the choice navigate; if the picker is still there afterwards
            // the loop clicks again, bounded by the same deadline.
            await new Promise((r) => setTimeout(r, 2000));
            continue;
        }

        if (state === "no-option") {
            logger.warn?.('   ⚠️  "Select a sales channel" is shown but has no AJIO option');
            return false;
        }

        if (picked) return true; // clicked, and the picker has gone

        await new Promise((r) => setTimeout(r, pollMs));
    }

    return picked;
}

const DEFAULT_PORTAL_URL = "https://seller.ajio.com/ajiocommerce/";

/**
 * One look at the page, run in the browser: where are we, and is the AJIO
 * portal's "Log in" launcher showing. With `click`, also presses the launcher.
 */
const lookAtPortal = (click) => {
    const visible = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };
    const byId = document.querySelector("#ui-btn");
    const launcher = visible(byId)
        ? byId
        : Array.from(document.querySelectorAll("a,button")).find(
              (n) => visible(n) && /^log\s*in/i.test((n.textContent || "").replace(/\s+/g, " ").trim())
          ) || null;

    if (click && launcher) launcher.click();

    return {
        onPortal: location.hostname.includes("seller.ajio.com"),
        launcher: Boolean(launcher),
        passwordForm: visible(document.querySelector("#loginForm #username")),
        mfa: Boolean(document.querySelector("#mfaForm")),
        complete: document.readyState === "complete",
    };
};

/**
 * From Reliance Seller Central to the AJIO seller portal.
 *
 * Accounts that are challenged with a one-time code (and multi-channel ones)
 * finish the SSO on Reliance Seller Central — sellers.relianceretail.com/scp/…
 * — instead of being sent back to seller.ajio.com. Every AJIO automation here
 * runs on seller.ajio.com (its bff_session cookie, its activeSellerProfileId),
 * so the sign-in is not done until the page is there.
 *
 * The Reliance session now exists, so opening the AJIO portal and pressing its
 * "Log in" launcher runs the OAuth round trip WITHOUT a password and lands back
 * on seller.ajio.com — the same place an unchallenged sign-in ends.
 *
 * @param {object} page a Puppeteer page signed in to Reliance Seller Central
 * @param {{ portalUrl?: string, timeoutMs?: number, logger?: object }} [options]
 * @returns {Promise<{ ok: true } | { ok: false, reasonText: string }>} never throws
 */
async function continueToAjioPortal(page, { portalUrl = DEFAULT_PORTAL_URL, timeoutMs = 60000, logger = console } = {}) {
    logger.info?.(`   ↪️  Signed in to Reliance Seller Central — continuing to the AJIO portal (${portalUrl})`);

    try {
        await page.goto(portalUrl, { waitUntil: "networkidle2", timeout: 45000 });
    } catch (err) {
        // ERR_ABORTED means the page started its own redirect — the round trip
        // we want; the loop below judges where it ends up.
        if (!/ERR_ABORTED/i.test(err.message || "")) {
            return { ok: false, reasonText: `could not open the AJIO portal — ${err.message}` };
        }
    }

    const deadline = Date.now() + timeoutMs;
    let launcherClicks = 0;
    let settledLooks = 0;

    while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));

        if ((await clickAjioSalesChannel(page)) === "clicked") {
            logger.info?.("   🏬 Picked the AJIO sales channel");
            settledLooks = 0;
            continue;
        }

        const state = await page.evaluate(lookAtPortal, false).catch(() => null);

        if (!state) {
            settledLooks = 0; // mid-navigation
            continue;
        }

        if (state.mfa) return { ok: false, reasonText: "AJIO asked for a second one-time code on the way to its portal" };
        if (state.passwordForm) {
            return { ok: false, reasonText: "the Reliance session did not carry over — AJIO asked for the password again" };
        }

        if (state.onPortal && state.launcher) {
            if (launcherClicks >= 2) return { ok: false, reasonText: "the AJIO portal kept showing its Log in launcher" };

            launcherClicks += 1;
            settledLooks = 0;
            await page.evaluate(lookAtPortal, true).catch(() => undefined);
            logger.info?.(`   🔓 Pressed the AJIO portal's Log in (${launcherClicks})`);
            continue;
        }

        // On seller.ajio.com, loaded, and no launcher — for two looks in a row,
        // so a launcher that renders a beat late is not mistaken for a session.
        if (state.onPortal && state.complete) {
            settledLooks += 1;
            if (settledLooks >= 2) {
                logger.info?.("   ✅ On the AJIO seller portal");
                return { ok: true };
            }
        } else {
            settledLooks = 0;
        }
    }

    return { ok: false, reasonText: `did not reach the AJIO seller portal (url: ${page.url()})` };
}

module.exports = {
    clickAjioSalesChannel,
    pickAjioSalesChannelIfShown,
    continueToAjioPortal,
    DEFAULT_PORTAL_URL,
    HEADING,
    CHANNEL,
};
