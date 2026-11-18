/**
 * Nykaa auto-claim helpers.
 *
 * Nykaa uses a Zoho-desk dispute portal (https://dispute.nykaa.com). The login
 * form is rendered INSIDE an iframe (#iamFrame → Zoho IAM), and is a two-step
 * flow: email → "Next" → password → "Sign in" (same #nextbtn button both steps).
 *
 * This file holds Nykaa-specific, reusable steps so scriptNew.js stays readable.
 */

const SIGNIN_URL = "https://dispute.nykaa.com/portal/en/signin";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve the Zoho IAM login iframe's content frame.
 * The login inputs (#login_id, #password, #nextbtn) live inside this iframe.
 */
async function getLoginFrame(page, timeout = 20000) {
    const iframeHandle = await page.waitForSelector("#iamFrame", { visible: true, timeout });
    const frame = await iframeHandle.contentFrame();
    if (!frame) throw new Error("Nykaa login: could not access #iamFrame content frame");
    // Wait for the email field inside the frame to be ready.
    await frame.waitForSelector("#login_id", { visible: true, timeout });
    return frame;
}

/**
 * Read a visible login error inside the iframe (e.g. "Incorrect password.").
 * Zoho shows it as `.fielderror.errorlabel` with display:block. Returns the
 * error text, or "" if none visible.
 */
async function readLoginError(frame) {
    return await frame.evaluate(() => {
        const isVisible = (el) => {
            if (!el) return false;
            const s = window.getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const errs = Array.from(document.querySelectorAll(".fielderror"))
            .filter((e) => isVisible(e) && (e.textContent || "").trim())
            .map((e) => e.textContent.trim());
        return errs.join(" | ");
    }).catch(() => "");
}

/**
 * Detect login blockers we cannot automate (captcha / OTP / MFA).
 * Returns a string describing the blocker, or null if none visible.
 */
async function detectLoginBlocker(frame) {
    return await frame.evaluate(() => {
        const isVisible = (el) => {
            if (!el) return false;
            const s = window.getComputedStyle(el);
            if (s.display === "none" || s.visibility === "hidden") return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const captcha = document.querySelector("#captcha_container");
        const otp = document.querySelector("#otp_container");
        const mfaTotp = document.querySelector("#mfa_totp_container");
        const mfaOtp = document.querySelector("#mfa_otp_container");
        if (isVisible(captcha)) return "CAPTCHA";
        if (isVisible(mfaTotp)) return "MFA_TOTP";
        if (isVisible(mfaOtp)) return "MFA_OTP";
        // OTP container is only a blocker if the OTP input itself is showing.
        const otpInput = document.querySelector("#otp");
        if (otp && isVisible(otp) && otpInput && isVisible(otpInput)) return "OTP";
        return null;
    });
}

/**
 * Log in to the Nykaa dispute portal.
 * Two-step inside #iamFrame: email → Next → password → Sign in.
 *
 * @param {import('puppeteer').Page} page
 * @param {{email: string, password: string}} credentials
 */
/**
 * "You're nearing your concurrent session limit" — take the Skip, never the
 * Terminate.
 *
 * A DIFFERENT PAGE from the daily sign-in limit below, and the reason a login
 * could loop: that handler clicks `#continue_button` ("I Understand"), which
 * this page does not advance on, so the poll dismissed the same screen five
 * times and then gave up.
 *
 * ⚠️ THE OTHER BUTTON MUST NOT BE CLICKED. "Terminate all other sessions" ends
 * every session the account holds — forty-five of them, belonging to other
 * machines and other people, including any run in flight elsewhere. This page
 * is only a WARNING (the cap is fifty); nothing is blocked yet, so "Skip for
 * now" costs nothing and the automation has no business making that decision.
 *
 * `dismissTerminateSessionsPopup` below does click Terminate, and that is
 * right where it is used: that popup appears when the account is AT the cap
 * and sign-in cannot proceed at all, so there is no choice left to make.
 *
 * Checked across every frame, like the popup below: where sign-in finishes
 * decides whether this renders in the parent document or inside #iamFrame.
 */
const REMIND_LATER_LINK = "a.remind_me_later";

async function skipConcurrentSessionReminder(page) {
    for (const frame of page.frames()) {
        try {
            const link = await frame.$(REMIND_LATER_LINK);

            if (!link) continue;

            const summary = await frame
                .$eval(".sessions-count, .concurrent-sessions", (el) => (el.textContent || "").trim())
                .catch(() => "");

            console.log(
                "ℹ️ [Nykaa] Concurrent-session reminder detected" +
                    `${summary ? ` — ${summary}` : ""} — clicking 'Skip for now' ` +
                    "(NOT 'Terminate all other sessions')"
            );

            await Promise.all([
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
                link.click(),
            ]);
            await sleep(1500);

            return true;
        } catch (_) {
            // Frame detached mid-check — nothing to skip there.
        }
    }

    return false;
}

// Dismiss the "You are nearing your daily sign-in limit" interstitial that
// Nykaa injects between successful sign-in and the portal dashboard when the
// account is close to its 20/day cap. If the button isn't present this is a
// no-op. Returns true if we clicked it, so the caller can retry state checks.
async function dismissSignInLimitInterstitial(page) {
    try {
        const btn = await page.$("#continue_button");
        if (!btn) return false;
        console.log("ℹ️ [Nykaa] Sign-in limit interstitial detected — clicking 'I Understand'");
        await Promise.all([
            page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
            btn.click(),
        ]);
        await sleep(1500);
        return true;
    } catch (_) {
        return false;
    }
}

// Nykaa caps how many sessions an account may hold open. Once the account is at
// that cap, sign-in stops on a "Terminate all other sessions" popup instead of
// continuing to the dashboard — the run then sits there until the 25s poll gives
// up. Click Terminate ourselves and give Nykaa 5s to drop the old sessions and
// route on. No-op (returns false) when the popup isn't showing.
//
// Checked across every frame: depending on where sign-in finishes, the popup
// renders either in the parent document or inside the #iamFrame login frame.
async function dismissTerminateSessionsPopup(page) {
    const selector = ".delete-popup.show button.confirm-delete_btn";

    for (const frame of page.frames()) {
        try {
            const btn = await frame.$(selector);
            if (!btn) continue;

            const desc = await frame
                .$eval(".delete-popup.show .delete-desc", (el) => (el.textContent || "").trim())
                .catch(() => "");
            console.log(
                `ℹ️ [Nykaa] 'Terminate all other sessions' popup detected${desc ? ` — ${desc}` : ""} — clicking Terminate`
            );

            /**
             * CLICKED IN THE PAGE, not at coordinates.
             *
             * `elementHandle.click()` scrolls the button into view and clicks
             * the middle of where it thinks it is — which lands on whatever is
             * actually on top. This popup renders over a dimmed backdrop inside
             * a modal that the portal animates in, and the click was going to
             * the overlay: the button was found, the click reported success,
             * and the popup stayed exactly where it was.
             *
             * `el.click()` dispatches on the element itself, so nothing can be
             * in front of it. The handle click is kept as a fallback for the
             * case a listener wants real pointer events.
             */
            await frame.evaluate((el) => el.click(), btn).catch(() => {});
            await sleep(1500);

            // Did it actually go? The class is the portal's own signal, so its
            // absence is the portal agreeing the popup is closed.
            let stillOpen = await frame
                .$(".delete-popup.show button.confirm-delete_btn")
                .then((node) => Boolean(node))
                .catch(() => false);

            if (stillOpen) {
                console.log("ℹ️ [Nykaa] Popup still open after the DOM click — trying a real click");
                await btn.click().catch(() => {});
                await sleep(1500);
                stillOpen = await frame
                    .$(".delete-popup.show button.confirm-delete_btn")
                    .then((node) => Boolean(node))
                    .catch(() => false);
            }

            if (stillOpen) {
                // Said out loud rather than returning true: a caller told the
                // popup was dismissed will re-poll for a dashboard that is
                // still behind it, and spend its whole budget doing so.
                console.log("⚠️ [Nykaa] 'Terminate' would not take — the popup is still showing");

                return false;
            }

            // Nykaa needs a moment to drop the sessions and route on.
            await sleep(3500);
            console.log("✅ [Nykaa] Terminate clicked — continuing.");

            return true;
        } catch (_) {
            // Frame detached while we were checking it — nothing to dismiss there.
        }
    }
    return false;
}

async function loginNykaa(page, credentials) {
    const email = credentials.email || credentials.username;
    const password = credentials.password;
    if (!email || !password) throw new Error("Nykaa login: email/password missing");

    console.log(`🔑 [Nykaa] Navigating to sign-in: ${SIGNIN_URL}`);
    await page.goto(SIGNIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(1500);
    // If Nykaa redirected an already-authenticated session straight onto the
    // sign-in-limit interstitial or the session-cap popup, clear them before
    // checking login state.
    // The confirm popup first: it is modal, so while it is open the "Skip for
    // now" link behind it cannot be clicked and trying only wastes the poll.
    await dismissTerminateSessionsPopup(page);
    await skipConcurrentSessionReminder(page);
    await dismissSignInLimitInterstitial(page);

    // Idempotent: if the session already exists, Nykaa redirects away from the
    // sign-in page (no login iframe) and shows the authenticated nav. Detect that
    // and skip login — avoids a 20s #iamFrame timeout when called while logged in.
    const alreadyLoggedIn = await page.evaluate(() => {
        const hasIframe = !!document.querySelector("#iamFrame");
        const hasMyArea = Array.from(document.querySelectorAll("a, span, button"))
            .some((el) => (el.textContent || "").trim() === "My Area");
        return !hasIframe && hasMyArea;
    }).catch(() => false);

    if (alreadyLoggedIn) {
        console.log("✅ [Nykaa] Already logged in — skipping login.");
        return true;
    }

    const frame = await getLoginFrame(page);
    console.log("✅ [Nykaa] Login iframe ready.");

    // Step 1: email → Next
    await frame.click("#login_id", { clickCount: 3 });
    await frame.type("#login_id", email, { delay: 80 });
    console.log(`⌨️ [Nykaa] Email entered: ${email}`);

    let blocker = await detectLoginBlocker(frame);
    if (blocker) throw new Error(`Nykaa login blocked at email step: ${blocker} required (cannot automate)`);

    await frame.click("#nextbtn");
    console.log("➡️ [Nykaa] Clicked Next.");

    // Step 2: wait for password field to become interactable, then Sign in.
    await frame.waitForSelector("#password", { visible: true, timeout: 15000 });
    await sleep(800);

    blocker = await detectLoginBlocker(frame);
    if (blocker) throw new Error(`Nykaa login blocked before password: ${blocker} required (cannot automate)`);

    await frame.click("#password", { clickCount: 3 });
    await frame.type("#password", password, { delay: 80 });
    console.log("⌨️ [Nykaa] Password entered.");

    // Submit (same #nextbtn, now labelled "Sign in"). On success the parent page
    // navigates; on failure the iframe stays and shows an inline error.
    await frame.click("#nextbtn");
    console.log("➡️ [Nykaa] Clicked Sign in.");

    // Race: either an inline error appears in the iframe (failure) or the parent
    // navigates to the portal (success). Poll both for up to ~25s.
    // Deadline is extended whenever we clear a popup — a dismissed popup is
    // progress, not stalling, and the Terminate flow alone costs 5s of it.
    let deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
        // 1. Failure: inline error inside the login iframe.
        try {
            const f = await (await page.$("#iamFrame"))?.contentFrame();
            if (f) {
                const errText = await readLoginError(f);
                if (errText) {
                    throw new Error(`Nykaa login failed: ${errText}`);
                }
                const blockerNow = await detectLoginBlocker(f);
                if (blockerNow) {
                    throw new Error(`Nykaa login blocked: ${blockerNow} required (cannot automate)`);
                }
            }
        } catch (e) {
            // Re-throw our own failure messages; ignore frame-detached errors
            // (iframe goes away once the portal navigates on success).
            if (/Nykaa login (failed|blocked)/.test(e.message)) throw e;
        }

        // 2. Interstitial: "You are nearing your daily sign-in limit" — Nykaa
        //    shows this after a successful auth POST but before the dashboard
        //    when the account is near its 20/day cap. Dismiss it and re-poll.
        // 1a. The Terminate CONFIRM popup, before anything else on the page:
        //     it is modal, so the reminder's own links are unclickable behind
        //     it and trying them first only burns the poll.
        if (await dismissTerminateSessionsPopup(page)) {
            deadline = Date.now() + 25000;
            continue;
        }

        // 1b. The concurrent-session WARNING, with no popup over it. Tried
        //     before the one below, because `#continue_button` does not move
        //     this page on and the poll would re-click it to no effect.
        if (await skipConcurrentSessionReminder(page)) {
            deadline = Date.now() + 25000;
            continue;
        }

        if (await dismissSignInLimitInterstitial(page)) {
            deadline = Date.now() + 25000;
            continue;
        }

        // 3. Success: sign-in iframe gone AND authenticated nav present.
        const url = page.url();
        const onPortal = await page.evaluate(() => {
            const hasIframe = !!document.querySelector("#iamFrame");
            const hasMyArea = Array.from(document.querySelectorAll("a, span, button"))
                .some((el) => (el.textContent || "").trim() === "My Area");
            return { hasIframe, hasMyArea };
        }).catch(() => ({ hasIframe: true, hasMyArea: false }));

        if (!onPortal.hasIframe && onPortal.hasMyArea && !/signin/i.test(url)) {
            console.log(`✅ [Nykaa] Logged in. URL: ${url}`);
            return true;
        }

        await sleep(1000);
    }

    throw new Error("Nykaa login: timed out confirming sign-in (no portal nav, no inline error within 25s)");
}

/**
 * From the portal home, open "My Area" (the seller's tickets list).
 * Nav link: <a href="/portal/en/myarea" aria-label="My Area">.
 */
async function goToMyArea(page) {
    const sel = 'a[href="/portal/en/myarea"]';
    console.log("🧭 [Nykaa] Opening My Area...");
    // The session-cap popup can also land here (it overlays the portal and eats
    // the click), so clear it before waiting on the nav link.
    await dismissTerminateSessionsPopup(page);
    await page.waitForSelector(sel, { visible: true, timeout: 20000 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
        page.click(sel),
    ]);
    await sleep(1500);

    const url = page.url();
    if (!/myarea/i.test(url)) {
        console.warn(`⚠️ [Nykaa] After clicking My Area, URL is "${url}" (expected /myarea).`);
    } else {
        console.log(`✅ [Nykaa] My Area open. URL: ${url}`);
    }
    return url;
}

/**
 * From My Area, click "Add ticket" to open the new-ticket form.
 * Link: <a data-id="addticket" href="/portal/en/newticket"><button>Add ticket</button></a>
 *
 * Nykaa then routes to /newticket?departmentId=…&layoutId=… (may auto-select the
 * department, or show a chooser → "Dispute Management" / "Nykaa Seller Claims").
 * We log the resulting URL so we can see which path this seller takes.
 */
async function clickAddTicket(page) {
    const sel = 'a[data-id="addticket"]';
    console.log("🧭 [Nykaa] Clicking 'Add ticket'...");
    await page.waitForSelector(sel, { visible: true, timeout: 20000 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
        page.click(sel),
    ]);
    await sleep(2000);

    const url = page.url();
    console.log(`✅ [Nykaa] After 'Add ticket'. URL: ${url}`);
    if (!/newticket/i.test(url)) {
        console.warn(`⚠️ [Nykaa] URL doesn't contain 'newticket' — a department/layout chooser may be shown.`);
    }
    return url;
}

/**
 * Convert claim email HTML to plain text (mirrors the AJIO script's htmlToText).
 */
function htmlToText(html) {
    if (!html) return "";
    html = String(html);
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    html = html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, (_, href) => href);
    html = html.replace(/<br\s*\/?>/gi, "\n");
    html = html.replace(/<\/p>/gi, "\n");
    html = html.replace(/<\/li>/gi, "\n");
    html = html.replace(/<li[^>]*>/gi, "\n");
    html = html.replace(/<[^>]+>/g, "");
    html = html.replace(/&nbsp;/gi, " ");
    html = html.replace(/&amp;/gi, "&");
    html = html.replace(/&lt;/gi, "<");
    html = html.replace(/&gt;/gi, ">");
    html = html.replace(/&quot;/gi, '"');
    html = html.replace(/&#39;/gi, "'");
    html = html.replace(/\n{2,}/g, "\n\n");
    html = html
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .replace(/\n{2,}/g, "\n\n")
        .trim();
    return html;
}

/**
 * Split the claim email into the two Nykaa form parts.
 *
 * - description: from "I hope this message" up to (excluding) "Return AWB Number".
 * - evidenceUrl: from "Return AWB Number" through the last evidence line,
 *   dropping the "Thank you / Best regards" closing.
 *
 * @param {string} emailBody HTML or plain text of the claim email
 * @returns {{ description: string, evidenceUrl: string }}
 */
function parseNykaaEmail(emailBody) {
    const text = htmlToText(emailBody);
    const MARKER = "Return AWB Number";

    const idx = text.indexOf(MARKER);
    let description = idx === -1 ? text : text.slice(0, idx);
    let evidenceUrl = idx === -1 ? "" : text.slice(idx);

    // Description: start at the greeting body if present.
    const hopeIdx = description.indexOf("I hope this message");
    if (hopeIdx !== -1) description = description.slice(hopeIdx);
    description = description.trim();

    // Evidence: cut the closing salutation so only the AWB/links block remains.
    for (const stop of ["Thank you for your prompt", "Thank you", "Best regards", "Best Regards"]) {
        const s = evidenceUrl.indexOf(stop);
        if (s !== -1) {
            evidenceUrl = evidenceUrl.slice(0, s);
            break;
        }
    }
    evidenceUrl = evidenceUrl.trim();

    return { description, evidenceUrl };
}

/**
 * Type into a plain text input on the ticket form (clears first).
 */
async function typeField(page, selector, value, label) {
    if (value == null || value === "") {
        console.log(`↪️ [Nykaa] Skipping ${label} (empty).`);
        return;
    }
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selector, String(value), { delay: 40 });
    console.log(`⌨️ [Nykaa] ${label} = "${value}"`);
}

/**
 * Set an input's value directly via the native setter + input/change events.
 * Used for the Evidence URL field, whose multi-line content can't be entered by
 * keystrokes into a single-line input.
 */
async function setInputValue(page, selector, value, label) {
    if (value == null || value === "") {
        console.log(`↪️ [Nykaa] Skipping ${label} (empty).`);
        return;
    }
    await page.waitForSelector(selector, { visible: true, timeout: 10000 });
    const ok = await page.evaluate((sel, val) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }, selector, String(value));
    if (!ok) throw new Error(`Nykaa form: ${label} input (${selector}) not found`);
    console.log(`⌨️ [Nykaa] ${label} set (${String(value).length} chars): ${value}`);
}

// CMS-value → exact portal option string, per Zoho dropdown field. Nykaa's
// portal has its own misspellings baked into the option strings (e.g. the
// Issue dropdown ships "Damaged / Defective Product Receieved" with an extra
// 'e'). Our CMS config uses whatever spelling was originally captured, so we
// translate here before clicking. Add a new entry whenever a CMS Claim Title
// doesn't match the portal exactly.
const NYKAA_OPTION_ALIASES = {
    Issue: {
        "Damaged / Defective Product Recieved": "Damaged / Defective Product Receieved",
        "Damaged / Defective Product Received": "Damaged / Defective Product Receieved",
    },
};

/**
 * Select an option in a Zoho custom dropdown (DropDown__ component).
 * @param {string} fieldName e.g. "Issue" or "Return Type" — matches dropdown_selected_<fieldName>
 * @param {string} optionValue exact visible value, e.g. "Wrong Product Returned - Other brand Product"
 *                 (the option's data-id is `<fieldName>_<optionValue>`)
 */
async function selectZohoDropdown(page, fieldName, optionValue, label) {
    if (optionValue == null || optionValue === "") {
        console.log(`↪️ [Nykaa] Skipping ${label} dropdown (empty).`);
        return;
    }
    const selectedSel = `[id="dropdown_selected_${fieldName}"]`;
    await page.waitForSelector(selectedSel, { visible: true, timeout: 10000 });

    // Open the dropdown.
    await page.click(selectedSel);
    await sleep(400);

    // Translate CMS value → portal-exact string via alias map before clicking.
    const aliased = NYKAA_OPTION_ALIASES[fieldName]?.[optionValue] || optionValue;
    if (aliased !== optionValue) {
        console.log(`🔁 [Nykaa] ${label} alias: "${optionValue}" → "${aliased}"`);
    }

    // Click the matching option by its data-id (exact value). Done in-page since
    // these are custom (non-native) list items.
    const dataId = `${fieldName}_${aliased}`;
    const clicked = await page.evaluate((dataId) => {
        const li = document.querySelector(`li[data-id="${dataId}"]`);
        if (!li) return false;
        const opt = li.querySelector('[role="option"]') || li;
        opt.click();
        return true;
    }, dataId);

    if (!clicked) {
        // Dump available options to make a mismatch obvious in logs.
        const available = await page.evaluate((fieldName) => {
            const ul = document.querySelector(`[id="dropdown_list_${fieldName}"]`);
            if (!ul) return [];
            return Array.from(ul.querySelectorAll("li")).map((li) => (li.getAttribute("data-id") || "").replace(`${fieldName}_`, ""));
        }, fieldName);
        await page.keyboard.press("Escape").catch(() => {});
        throw new Error(`Nykaa form: ${label} option "${aliased}" not found (from CMS "${optionValue}"). Available: ${JSON.stringify(available)}`);
    }
    await sleep(400);
    console.log(`✅ [Nykaa] ${label} = "${aliased}"`);
}

/**
 * Set the rich-text Description (Zoho KB_Editor contenteditable).
 */
async function setDescription(page, text, label = "Description") {
    if (text == null || text === "") {
        console.log(`↪️ [Nykaa] Skipping ${label} (empty).`);
        return;
    }
    const containerSel = "#field_description";
    await page.waitForSelector(containerSel, { visible: true, timeout: 10000 });

    const editableHandle = await page.evaluateHandle((containerSel) => {
        const c = document.querySelector(containerSel);
        if (!c) return null;
        return c.querySelector('[contenteditable="true"]') || c.querySelector("#description") || c;
    }, containerSel);
    const editable = editableHandle.asElement();
    if (!editable) throw new Error("Nykaa form: Description editor not found");

    await editable.click();
    await sleep(200);
    await page.keyboard.type(String(text), { delay: 10 });
    console.log(`⌨️ [Nykaa] ${label} set (${String(text).length} chars): ${text}`);
}

/**
 * Fill the Submit-a-Ticket form from a data object. Does NOT submit.
 *
 * @param {object} data
 *   { subject, vendorCode, skuId, reverseAwb, issue, returnType,
 *     description, evidenceUrl, emailBody }
 *   If `emailBody` is provided, description + evidenceUrl are derived from it
 *   via parseNykaaEmail() (explicit description/evidenceUrl override).
 */
async function fillTicketForm(page, data) {
    console.log("📝 [Nykaa] Filling ticket form...");
    await page.waitForSelector("#ticketform_fields_container", { visible: true, timeout: 20000 });

    // Derive Description + Evidence URL from the claim email when provided.
    let description = data.description;
    let evidenceUrl = data.evidenceUrl;
    if (data.emailBody) {
        const parsed = parseNykaaEmail(data.emailBody);
        if (description == null) description = parsed.description;
        if (evidenceUrl == null) evidenceUrl = parsed.evidenceUrl;
    }

    await typeField(page, "#subject", data.subject, "Subject");
    await typeField(page, "#cf_vendor_code", data.vendorCode, "Vendor Code");
    await typeField(page, "#cf_sku_id", data.skuId, "SKU ID");
    await typeField(page, "#cf_awb_dto_rto", data.reverseAwb, "Reverse AWB");
    await selectZohoDropdown(page, "Issue", data.issue, "Issue");
    if (data.returnType) {
        await selectZohoDropdown(page, "Return Type", data.returnType, "Return Type");
    }
    await setDescription(page, description, "Description");

    // Evidence URL is a single-line input — newlines collapse and run words
    // together. Flatten the block into " | "-separated segments so each
    // label/value/link stays readable.
    const flatEvidence = evidenceUrl
        ? evidenceUrl.split(/\n+/).map((s) => s.trim()).filter(Boolean).join(" | ")
        : evidenceUrl;
    await setInputValue(page, "#cf_evidence_url", flatEvidence, "Evidence URL");

    console.log("✅ [Nykaa] Ticket form filled (NOT submitted).");
}

module.exports = {
    SIGNIN_URL,
    sleep,
    getLoginFrame,
    detectLoginBlocker,
    readLoginError,
    dismissTerminateSessionsPopup,
    skipConcurrentSessionReminder,
    loginNykaa,
    goToMyArea,
    clickAddTicket,
    htmlToText,
    parseNykaaEmail,
    typeField,
    setInputValue,
    selectZohoDropdown,
    setDescription,
    fillTicketForm,
};
