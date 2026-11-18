const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
    DEFAULT_SETTLE_MS,
    otpSettleMs,
    settleBeforeOtpRead,
} = require("../common/otpTiming.js");

/**
 * The pause between a login click and the first mailbox read.
 *
 * WHAT IT PREVENTS is not a slow login — it is the WRONG CODE. A portal retires
 * the previous OTP the instant it issues a new one, and the mailbox delivers
 * the new one seconds later. Read too early and the freshest mail in the box is
 * still the retired code: the automation types it, the portal refuses, and the
 * report says nothing about a race. It reads as a wrong password, or as the
 * portal being flaky.
 *
 * The "arrived after the click" cutoff every reader already applies does not
 * settle it either, because the timestamp being compared is the mail's own Date
 * header — written by the sending server, whose clock is not this machine's.
 */

test("waits half a minute by default", () => {
    assert.equal(otpSettleMs("flipkart", {}), 30_000);
    assert.equal(otpSettleMs("tatacliq", {}), DEFAULT_SETTLE_MS);
});

test("one platform can be tuned without moving the other", () => {
    // A relay that is slower for one portal is not a reason to slow every login.
    const env = { FLIPKART_OTP_SETTLE_MS: "45000" };

    assert.equal(otpSettleMs("flipkart", env), 45_000);
    assert.equal(otpSettleMs("tatacliq", env), 30_000);
});

test("a global override moves both, and a platform still outranks it", () => {
    assert.equal(otpSettleMs("tatacliq", { OTP_SETTLE_MS: "12000" }), 12_000);
    assert.equal(
        otpSettleMs("flipkart", { OTP_SETTLE_MS: "12000", FLIPKART_OTP_SETTLE_MS: "1000" }),
        1_000
    );
});

test("zero means zero — it is a setting, not a missing value", () => {
    // The test suite and a hand-run sign-in both want "do not wait", and a
    // falsy check here would silently restore the full thirty seconds.
    assert.equal(otpSettleMs("flipkart", { OTP_SETTLE_MS: "0" }), 0);
});

test("nonsense falls through rather than waiting forever, or not at all", () => {
    assert.equal(otpSettleMs("flipkart", { FLIPKART_OTP_SETTLE_MS: "soon" }), 30_000);
    assert.equal(otpSettleMs("flipkart", { FLIPKART_OTP_SETTLE_MS: "-5" }), 30_000);
});

test("says out loud that it is waiting, and skips the wait when told to", async () => {
    // A login that sits silent for thirty seconds after the password looks
    // stuck. The line is what stops the next person hunting for a hang.
    const said = [];
    const waited = await settleBeforeOtpRead("flipkart", {
        logger: { info: (message) => said.push(message) },
        env: { OTP_SETTLE_MS: "0" },
    });

    assert.equal(waited, 0);
    assert.deepEqual(said, [], "nothing to announce when nothing is waited");
});
