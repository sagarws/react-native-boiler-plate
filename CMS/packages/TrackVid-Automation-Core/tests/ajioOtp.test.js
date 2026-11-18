const assert = require("node:assert/strict");
const { test } = require("node:test");

const { codeIn } = require("../platforms/ajio/common/getOtp.js");
const { waitForAjioLoginOutcome } = require("../platforms/ajio/common/loginErrors.js");
const { answerAjioMfa } = require("../platforms/ajio/common/mfa.js");
const loginForm = require("../platforms/ajio/common/loginForm.js");

/**
 * AJIO's Reliance SSO challenges some accounts with a mailed one-time code
 * ("OTP AUTHENTICATION" from no-reply_sellercentral@ril.com) instead of
 * redirecting to seller.ajio.com.
 */

test("reads the code from the Reliance mail body", () => {
    const body =
        "Thank you for choosing to partner with us on Reliance Retail Seller Central. " +
        "Please use the One time password (OTP) below to proceed.\n\nYour OTP Code\n704662\nExpires in 10 minutes";

    assert.equal(codeIn(body), "704662");
});

test("reads a letter-spaced code", () => {
    assert.equal(codeIn("Your OTP Code 7 0 4 6 6 2 Expires in 10 minutes"), "704662");
});

test("never reads the validity window or a year as the code", () => {
    assert.equal(codeIn("Expires in 10 minutes. © 2026 Reliance Retail"), null);
});

/** A fake page whose document either is or is not the MFA form. */
const fakePage = ({ onPortal = false, onMfa = false, errorText = "" } = {}) => ({
    evaluate: async (fn) => {
        const src = String(fn);

        if (src.includes("location.hostname")) return onPortal;
        if (src.includes("#mfaForm")) return onMfa;

        return errorText;
    },
});

test("the MFA page is reported as an OTP challenge only when asked", async () => {
    const page = fakePage({ onMfa: true });

    const asked = await waitForAjioLoginOutcome(page, { timeoutMs: 1000, pollMs: 10, detectOtp: true });

    assert.equal(asked.ok, false);
    assert.equal(asked.otp, true);
    assert.equal(asked.isBadCreds, false);

    // Existing callers (Automated-Scripts passes no detectOtp) are untouched.
    const legacy = await waitForAjioLoginOutcome(page, { timeoutMs: 50, pollMs: 10 });

    assert.equal(legacy.otp, undefined);
    assert.equal(legacy.timedOut, true);
});

test("a wrong-code toast on the MFA page is never read as a bad password", async () => {
    const page = fakePage({ onMfa: true, errorText: "Authentication failed" });
    const outcome = await waitForAjioLoginOutcome(page, { timeoutMs: 1000, pollMs: 10, detectOtp: true });

    assert.equal(outcome.otp, true);
    assert.equal(outcome.isBadCreds, false);
});

test("without a mailbox reader the challenge fails as OTP_REQUIRED, not as a credential", async () => {
    const result = await answerAjioMfa({}, "seller@example.com", { fetchOtp: null, logger: {} });

    assert.equal(result.ok, false);
    assert.match(result.reasonText, /^OTP_REQUIRED:/);
});

test("the desktop descriptor recognises and can answer the challenge", () => {
    assert.ok(loginForm.otp.anySelector.includes("#mfaForm #otp"));
    assert.deepEqual(loginForm.otpEntry, { input: "#mfaForm #otp", submit: "#mfaSubmitBtn" });
});

const { pickAjioSalesChannelIfShown } = require("../platforms/ajio/common/salesChannel.js");

/** A page whose picker answers each look with the next state in `states`. */
const pickerPage = (states) => ({ evaluate: async () => states.shift() ?? "absent" });
const quiet = { info() {}, warn() {} };

test("multi-channel accounts: AJIO is picked from \"Select a sales channel\"", async () => {
    const picked = await pickAjioSalesChannelIfShown(pickerPage(["absent", "clicked", "absent"]), {
        detectWaitMs: 5000,
        pollMs: 10,
        logger: quiet,
    });

    assert.equal(picked, true);
});

test("no picker is a quick no-op", async () => {
    const started = Date.now();
    const picked = await pickAjioSalesChannelIfShown(pickerPage([]), { detectWaitMs: 100, pollMs: 10, logger: quiet });

    assert.equal(picked, false);
    assert.ok(Date.now() - started < 1000);
});

test("a picker without an AJIO option is not clicked blindly", async () => {
    const picked = await pickAjioSalesChannelIfShown(pickerPage(["no-option"]), { detectWaitMs: 5000, logger: quiet });

    assert.equal(picked, false);
});

test("the desktop descriptor clicks through the sales-channel picker", () => {
    assert.deepEqual(loginForm.interstitials, [{ whenText: "Select a sales channel", clickText: "AJIO" }]);
});

const { continueToAjioPortal } = require("../platforms/ajio/common/salesChannel.js");

/**
 * A page for the Reliance → AJIO hop. Channel-picker looks (string args) see no
 * picker; portal looks (boolean arg) answer with the next state in `looks`.
 */
const portalPage = (looks) => {
    const calls = { goto: [], clicks: 0 };
    const page = {
        goto: async (url) => calls.goto.push(url),
        url: () => "https://example.test/",
        evaluate: async (fn, arg) => {
            if (typeof arg !== "boolean") return "absent";
            if (arg) calls.clicks += 1;
            return looks.length > 1 ? looks.shift() : looks[0];
        },
    };
    return { page, calls };
};

test("an SSO that ends on Reliance Seller Central continues to the AJIO portal", async () => {
    const { page, calls } = portalPage([
        { onPortal: true, launcher: true, complete: true },
        { onPortal: true, launcher: true, complete: true },
        { onPortal: true, launcher: false, complete: true },
    ]);
    const result = await continueToAjioPortal(page, { portalUrl: "https://seller.ajio.com/ajiocommerce/", logger: quiet });

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls.goto, ["https://seller.ajio.com/ajiocommerce/"]);
    assert.equal(calls.clicks, 1);
});

test("a Reliance session that does not carry over fails, naming why", async () => {
    const { page } = portalPage([{ onPortal: false, passwordForm: true }]);
    const result = await continueToAjioPortal(page, { logger: quiet });

    assert.equal(result.ok, false);
    assert.match(result.reasonText, /password again/);
});

const { IDENTITY_CHECKS } = require("../common/sessionIdentity.js");
const { normalise } = require("../common/renewSession.js");

test("the AJIO identity probe sends only seller.ajio.com's cookies, as a browser would", () => {
    const jar = [
        { name: "bff_session", value: "RELIANCE", domain: "sellers.relianceretail.com" },
        { name: "bff_session", value: "AJIO", domain: "seller.ajio.com" },
        { name: "ak_bmsc", value: "x", domain: ".ajio.com" },
        { name: "_ga", value: "y", domain: ".relianceretail.com" },
    ];

    assert.equal(IDENTITY_CHECKS.ajio.request({ jar }).headers.cookie, "bff_session=AJIO; ak_bmsc=x");
});

test("a cookie-array session reports cookie names, not array positions", async () => {
    const { renewPlatformSession, LOGINS } = require("../common/renewSession.js");
    const original = LOGINS.ajio;

    LOGINS.ajio = () => async () => ({ jar: [{ name: "bff_session", value: "v" }], userId: "u", pobIds: ["p"] });

    try {
        const result = await renewPlatformSession("ajio", { username: "x" });

        assert.deepEqual(result.cookieNames, ["bff_session"]);
        assert.equal(typeof normalise, "function");
    } finally {
        LOGINS.ajio = original;
    }
});
