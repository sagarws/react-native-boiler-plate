const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.CLOUDFLARE_OTP_SETTLE_MS = "0";
process.env.CLOUDFLARE_CODE_PAGE_TIMEOUT_MS = "50";
process.env.CLOUDFLARE_VERIFY_TIMEOUT_MS = "50";

const { extractCloudflareOtp, DEFAULT_TO } = require("../platforms/tatacliq/common/cloudflareOTP.js");
const {
    isCloudflareAccessUrl,
    passCloudflareAccess,
} = require("../platforms/tatacliq/common/cloudflareAccess.js");

/**
 * sellerzone.tatacliq.com is sometimes answered by Cloudflare Access
 * (tulunistore.cloudflareaccess.com): email → mailed 6-digit code → Verify →
 * back to the seller zone. The Access email is a second identity on the Tata
 * CliQ credential, an inbox with no password.
 */

test("reads the code from the HTML body, label and code in separate elements", () => {
    const html = "<h2>Your Cloudflare Access code</h2><p style=\"font-size:24px\">341131</p><p>Expires after 10 minutes</p>";

    assert.equal(extractCloudflareOtp({ html }), "341131");
});

test("reads the code from the plain-text preview", () => {
    assert.equal(extractCloudflareOtp({ text: "Your login code: 313498 Your Cloudflare Access code 313498" }), "313498");
});

test("never reads the footer's year or postal code", () => {
    assert.equal(extractCloudflareOtp({ html: "<p>© 2026 Cloudflare, Inc. San Francisco, CA 94107</p>" }), null);
    assert.equal(extractCloudflareOtp(null), null);
});

test("defaults to jyothi@wrogn.com", () => {
    assert.equal(DEFAULT_TO, "jyothi@wrogn.com");
});

test("recognises the Access host, not the portal", () => {
    assert.equal(isCloudflareAccessUrl("https://tulunistore.cloudflareaccess.com/cdn-cgi/access/login/x"), true);
    assert.equal(isCloudflareAccessUrl("https://sellerzone.tatacliq.com/"), false);
    assert.equal(isCloudflareAccessUrl("not a url"), false);
});

/**
 * A page that walks the two Access forms. `accept` decides whether Verify lets
 * the page go back to the seller zone.
 */
function fakeAccessPage({ startOnAccess = true, accept = true, sentTo = "jyothi@wrogn.com" } = {}) {
    const state = { url: startOnAccess ? "https://tulunistore.cloudflareaccess.com/cdn-cgi/access/login/sellerzone" : "https://sellerzone.tatacliq.com/", step: "email", typed: {}, clicks: [] };
    const isCode = (sel) => sel.includes("otp-code-input");
    const isEmail = (sel) => sel.includes("email-input");

    return {
        state,
        url: () => state.url,
        evaluate: async () => state.url.includes("cloudflareaccess"),
        $: async (sel) => (isCode(sel) && state.step === "code" ? {} : null),
        $eval: async () => sentTo,
        waitForSelector: async (sel) => {
            if (isEmail(sel) && state.step === "email") return {};
            if (isCode(sel) && state.step === "code") return {};
            throw new Error(`timeout ${sel}`);
        },
        click: async (sel) => {
            state.clicks.push(sel);
            if (sel.includes("email-submit-button")) state.step = "code";
            if (sel.includes("verify-otp-code-button") && accept) state.url = "https://sellerzone.tatacliq.com/";
        },
        keyboard: { press: async () => undefined },
        type: async (sel, value) => {
            state.typed[isCode(sel) ? "code" : "email"] = value;
        },
        waitForNavigation: async () => null,
        waitForFunction: async () => {
            if (state.url.includes("cloudflareaccess")) throw new Error("timeout");
        },
    };
}

test("no gate: a no-op that never asks for a code", async () => {
    const page = fakeAccessPage({ startOnAccess: false });
    let asked = false;

    const result = await passCloudflareAccess(page, { email: "a@b.com", fetchOtp: async () => { asked = true; } });

    assert.deepEqual(result, { passed: false });
    assert.equal(asked, false);
});

test("gate: types the email, waits for a code newer than the request, verifies", async () => {
    const page = fakeAccessPage();
    const calls = [];

    const result = await passCloudflareAccess(page, {
        email: "jyothi@wrogn.com",
        fetchOtp: async (email, since) => {
            calls.push({ email, since });
            return "341131";
        },
        logger: { info() {}, warn() {} },
    });

    assert.deepEqual(result, { passed: true, email: "jyothi@wrogn.com" });
    assert.equal(page.state.typed.email, "jyothi@wrogn.com");
    assert.equal(page.state.typed.code, "341131");
    assert.equal(calls[0].email, "jyothi@wrogn.com");
    assert.ok(calls[0].since instanceof Date);
    assert.equal(page.url(), "https://sellerzone.tatacliq.com/");
});

test("gate with no Access email: CLOUDFLARE_ACCESS_REQUIRED, nothing typed", async () => {
    const page = fakeAccessPage();

    await assert.rejects(
        passCloudflareAccess(page, { email: "", fetchOtp: async () => "123456" }),
        (err) => err.code === "CLOUDFLARE_ACCESS_REQUIRED"
    );
    assert.equal(page.state.typed.email, undefined);
});

test("gate with no code reader: CLOUDFLARE_ACCESS_REQUIRED", async () => {
    await assert.rejects(
        passCloudflareAccess(fakeAccessPage(), { email: "jyothi@wrogn.com" }),
        (err) => err.code === "CLOUDFLARE_ACCESS_REQUIRED"
    );
});

test("a refused code: CLOUDFLARE_OTP_WRONG", async () => {
    await assert.rejects(
        passCloudflareAccess(fakeAccessPage({ accept: false }), {
            email: "jyothi@wrogn.com",
            fetchOtp: async () => "000000",
            logger: { info() {}, warn() {} },
        }),
        (err) => err.code === "CLOUDFLARE_OTP_WRONG"
    );
});

test("no code arrives: CLOUDFLARE_OTP_FETCH_FAILED with the last reason", async () => {
    await assert.rejects(
        passCloudflareAccess(fakeAccessPage(), {
            email: "jyothi@wrogn.com",
            fetchOtp: async () => {
                throw new Error("IMAP down");
            },
            otpWaitMs: 30,
            logger: { info() {}, warn() {} },
        }),
        (err) => err.code === "CLOUDFLARE_OTP_FETCH_FAILED" && /IMAP down/.test(err.message)
    );
});
