// -----------------------------------------------------------------------------
// Delhivery login error classification
// -----------------------------------------------------------------------------
// Distinguish true bad-credential errors (Keycloak rejected the password)
// from transient issues (network, captcha, timeout). Only the former should
// unverify the credential — the rest are worth retrying.
//
// Keycloak's `/token` endpoint answers 401 with a body like:
//   { "error": "invalid_grant", "error_description": "Invalid user credentials" }
// on bad passwords. The Selenium bootstrap path throws an error whose message
// starts with "INVALID_CREDENTIALS:" when it sees that response OR when the
// browser flow ends with the login form still visible after submit.
// -----------------------------------------------------------------------------

const {
	INVALID_CREDENTIALS_PREFIX,
	isInvalidCredentialsError,
} = require("../../../common/credentialErrors");

// The browser paths never see Keycloak's JSON — the SPA swallows the 401 and
// paints an inline banner instead, then simply stops. Both runners
// (Puppeteer claimApiFlow.js, Selenium delhiveryAutoClaim/utils.js) match this
// text to tell "password rejected" apart from "login hung", so it lives here
// with the rest of the contract:
//
//   <div class="text-sm text-delhivery-error bg-delhivery-error/10 p-3 rounded-md">
//     Invalid username or password.
//   </div>
//
// Kept anchored on "invalid" so ordinary form hints ("Password must be at
// least 8 characters") can never unverify a working credential.
//
// AND THE LOCK-OUT MODAL. After five wrong passwords Delhivery stops showing
// the banner and paints a "Let's help you get back in" modal instead:
//
//   It looks like you've entered an incorrect password 5 times for
//   <email>. To protect your account, we have locked login attempts.
//
// Nothing else on the page changes, so without this the login sat on the
// modal until LOGIN_TIMEOUT ("Waiting failed: 30000ms exceeded") and the
// credential stayed verified — to be tried, and refused, again on every run.
// It is the same verdict as the banner, only louder: the password is wrong,
// and only a reset fixes it. Anchored on the modal's own two phrases ("…
// incorrect password N times", "locked login attempts"), never on "reset
// password", which the landing page links to on every visit.
const INVALID_CREDENTIAL_TEXT =
    /invalid\s*(user\s?name|username|email|user)?\s*(or|\/|,)?\s*password|invalid\s*(login\s*)?credential|incorrect\s+password\s+\d+\s+times|locked\s+login\s+attempts/i;

// Class fragment Delhivery keeps stable across frontend builds (the tailwind
// sizing/spacing classes around it churn), plus the generic alert role as a
// fallback. Presence alone is never enough — the text must match too.
const INVALID_CREDENTIAL_SELECTOR = '[class*="delhivery-error"], [role="alert"]';


module.exports = {
    isInvalidCredentialsError,
    INVALID_CREDENTIALS_PREFIX,
    INVALID_CREDENTIAL_TEXT,
    INVALID_CREDENTIAL_SELECTOR,
};
