// -----------------------------------------------------------------------------
// Finding a one-time-code box, without depending on class names
// -----------------------------------------------------------------------------
// Marketplaces build these with CSS-in-JS, so the class names are hashes:
// Flipkart's modal is `sc-pLyGp JpPRk`, and it changes whenever they rebuild.
// Anything anchored to those is broken by a deploy nobody told us about.
//
// So look for what an OTP box IS rather than what a framework called it. Every
// implementation of this control, on every site, is the same thing: a short run
// of inputs that each accept exactly ONE character. `maxlength="1"` is the
// defining property — it is what makes the digits jump forward as you type, so
// it cannot be dropped without changing the control into something else.
//
// The named selectors are tried first because they are cheap and precise while
// they last. The structural rule is the safety net: it holds through a redesign,
// a rename, or a rewrite in a different framework.
//
// Returns a COUNT rather than elements so the caller can decide what a partial
// match means — a modal mid-render shows fewer boxes than it will in a moment.
// -----------------------------------------------------------------------------

/**
 * Selectors in confidence order. Each is a plain CSS selector so it works in
 * Selenium (`By.css`) and Puppeteer (`$$`) alike.
 *
 *  1. the semantic class these controls almost always carry
 *  2. the accessible name — screen readers need it, so it survives redesigns
 *     that drop everything else
 *  3. the wrapper, for markup that only labels the container
 *  4. STRUCTURAL: single-character inputs. No names at all.
 */
const OTP_SELECTORS = [
    "input.otp-input",
    'input[aria-label*="verification code" i]',
    'input[aria-label^="Digit" i]',
    ".otp-input-wrapper input",
    'input[maxlength="1"][type="tel"]',
    'input[maxlength="1"]',
];

/** A run this short is a date field or a PIN-ish input, not a one-time code. */
const MIN_BOXES = 4;
/** Longer than this and it is not an OTP control. */
const MAX_BOXES = 8;

/**
 * Counts visible one-time-code inputs on the page.
 *
 * Runs entirely in the page so it costs one round trip however many selectors
 * are tried, and so visibility is judged by the browser rather than inferred.
 *
 * @param {(script: string) => Promise<any>} evaluate  page.evaluate / executeScript
 * @returns {Promise<{ count: number, matchedBy: string|null }>}
 */
async function countOtpInputs(evaluate) {
    // An IIFE, not a bare function body. Puppeteer's page.evaluate takes an
    // EXPRESSION and Selenium's executeScript takes a function BODY, so a
    // top-level `return` works in one and is a syntax error in the other —
    // silently, as a rejected promise that reads like "no modal found".
    // Wrapping it makes one string valid in both; Selenium callers prefix
    // "return " to get the value back out.
    const script = `(function () {
        var SELECTORS = ${JSON.stringify(OTP_SELECTORS)};
        var MIN = ${MIN_BOXES}, MAX = ${MAX_BOXES};
        function visible(el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        for (var i = 0; i < SELECTORS.length; i++) {
            var found;
            try { found = Array.prototype.slice.call(document.querySelectorAll(SELECTORS[i])); }
            catch (e) { continue; }
            found = found.filter(visible);
            if (found.length >= MIN && found.length <= MAX) {
                return { count: found.length, matchedBy: SELECTORS[i] };
            }
        }
        return { count: 0, matchedBy: null };
    })()`;

    try {
        const result = await evaluate(script);
        return result && typeof result.count === "number" ? result : { count: 0, matchedBy: null };
    } catch (_) {
        // Mid-navigation, or the document is not ready. Not there YET.
        return { count: 0, matchedBy: null };
    }
}

/**
 * Waits for a one-time-code box to appear.
 *
 * `timeoutMs` is generous by default: the modal shows only after the portal has
 * actually sent the code, which is a round trip to an SMS or mail gateway. The
 * old 8-second window was shorter than that gateway on a slow day, so a modal
 * that was about to appear was reported as "no OTP modal" and the sign-in
 * carried on as though it had succeeded.
 *
 * @returns {Promise<{ found: boolean, count: number, matchedBy: string|null }>}
 */
async function waitForOtpInputs(evaluate, { timeoutMs = 30000, pollMs = 500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = { count: 0, matchedBy: null };

    while (Date.now() < deadline) {
        last = await countOtpInputs(evaluate);
        if (last.count >= MIN_BOXES) {
            return { found: true, ...last };
        }
        await new Promise((r) => setTimeout(r, pollMs));
    }

    return { found: false, ...last };
}

/**
 * The probe as a standalone expression.
 *
 * Puppeteer: `page.evaluate(otpProbeExpression())`
 * Selenium:  `driver.executeScript('return ' + otpProbeExpression())`
 */
function otpProbeExpression() {
    return `(function () {
        var SELECTORS = ${JSON.stringify(OTP_SELECTORS)};
        var MIN = ${MIN_BOXES}, MAX = ${MAX_BOXES};
        function visible(el) {
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }
        for (var i = 0; i < SELECTORS.length; i++) {
            var found;
            try { found = Array.prototype.slice.call(document.querySelectorAll(SELECTORS[i])); }
            catch (e) { continue; }
            found = found.filter(visible);
            if (found.length >= MIN && found.length <= MAX) {
                return { count: found.length, matchedBy: SELECTORS[i] };
            }
        }
        return { count: 0, matchedBy: null };
    })()`;
}

module.exports = {
    OTP_SELECTORS,
    MIN_BOXES,
    MAX_BOXES,
    otpProbeExpression,
    countOtpInputs,
    waitForOtpInputs,
};
