const test = require("node:test");
const assert = require("node:assert");

const { INVALID_CREDENTIAL_TEXT } = require("../platforms/delhivery/common/loginErrors");

// Both login paths — CMS's Puppeteer flow and the server's Selenium flow —
// decide "the password was refused" with this one pattern, and a refusal is
// what unverifies the credential. So it is pinned both ways: what must match,
// and the ordinary page text that must never take a working login out.

test("matches the inline rejected-password banner", () => {
    assert.ok(INVALID_CREDENTIAL_TEXT.test("Invalid username or password."));
});

test("matches the lock-out modal after repeated wrong passwords", () => {
    const modal =
        "Let's help you get back in It looks like you've entered an incorrect password 5 times " +
        "for johnson@wrogn.com. To protect your account, we have locked login attempts. " +
        "Don't worry, it's easy to get back on track. Click on the link below to reset your " +
        "password and you can log in again. Reset Password";

    assert.ok(INVALID_CREDENTIAL_TEXT.test(modal));
    assert.ok(INVALID_CREDENTIAL_TEXT.test("we have locked login attempts"));
    assert.ok(INVALID_CREDENTIAL_TEXT.test("entered an incorrect password 3 times"));
});

test("does not match ordinary login-page text", () => {
    for (const text of [
        "Password must be at least 8 characters",
        "Forgot password? Reset password",
        "Enter your password",
        "Login to Delhivery One",
    ]) {
        assert.ok(!INVALID_CREDENTIAL_TEXT.test(text), text);
    }
});
