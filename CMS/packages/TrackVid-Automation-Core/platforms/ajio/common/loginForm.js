// AJIO — scripted sign-in for the desktop app's session re-capture.
//
// Selectors and sequence lifted from the Puppeteer login in ./login.js, which
// is the authority.
//
// The shape that matters: `loginUrl` is https://seller.ajio.com/, and that is a
// MARKETING landing page, not a form. AJIO moved to Reliance Retail OAuth SSO
// in 2026-07 — the old in-page `form#ui-form` is gone. The landing page shows a
// "Log in" launcher which redirects to sellers.relianceretail.com/auth/oauth/
// authorize, and only that page renders `form#loginForm` (#username /
// #password / #submitBtn). On success it OAuth-callbacks back to
// seller.ajio.com/malekith/auth/ns_vms/callback.
//
// So the launcher click is not optional decoration — without it the form never
// appears and the sign-in waits out its timeout on a page of marketing copy.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "ajio",
    steps: [
        // Some builds redirect straight to SSO, so both launcher attempts are
        // skipped once the form is up. #ui-btn first because it is the real id;
        // the text match is the fallback for when that id changes, and it is
        // `contains` because the button reads "Log in →".
        {
            kind: "click",
            selector: "#ui-btn",
            label: "Log in launcher",
            optional: true,
            skipIfSelector: "#loginForm #username",
        },
        {
            kind: "clickText",
            text: "Log in",
            match: "contains",
            label: "Log in launcher (by text)",
            optional: true,
            skipIfSelector: "#loginForm #username",
        },
        // 60s, matching the server login. This is a full OAuth redirect chain
        // to a different origin, and 20s is not enough for it on a cold cache.
        {
            kind: "wait",
            selector: "#loginForm #username",
            label: "Reliance SSO sign-in form",
            timeoutMs: 60000,
        },
        { kind: "fill", selector: "#username", field: "username" },
        { kind: "fill", selector: "#password", field: "password" },
        { kind: "settle", ms: 800 },
        { kind: "click", selector: "#submitBtn", label: "Sign in" },
    ],
    // Success is "we are back on seller.ajio.com" — the exact test the server
    // login uses (waitForAjioLoginOutcome in ./loginErrors.js). By the time the
    // outcome is polled the page is on sellers.relianceretail.com, because the
    // launcher took it there, so returning to the seller host means the OAuth
    // round trip completed.
    //
    // This is only safe because the `wait` for #loginForm #username above is
    // NOT optional: it guarantees we actually left seller.ajio.com before any
    // outcome is read. Make that step optional and this rule starts matching
    // the marketing landing page we began on, and reports instant success.
    success: { urlIncludes: ["seller.ajio.com"] },
    // The three places Reliance SSO puts an error, from READ_LOGIN_ERROR in
    // ./loginErrors.js: page flash, inline field error, error toast (which is
    // where the account-locked popup lives).
    failure: { anySelector: ["#uap-flash", ".field-error", ".uap-toast--error"] },
    // Some accounts are challenged after the password: the SSO renders
    // "Verify your identity" (`form#mfaForm`, POSTing to /authorize/mfa) and
    // mails the code. A driver checks this BEFORE `success`, which matters
    // here — the MFA page's own URL carries `redirect_uri=…seller.ajio.com…`.
    otp: { anySelector: ["#mfaForm #otp"], urlIncludes: ["/authorize/mfa"] },
    // One six-digit box and a Verify button. A driver that can read the
    // mailbox fills these and the sign-in finishes unattended.
    otpEntry: { input: "#mfaForm #otp", submit: "#mfaSubmitBtn" },
    // Multi-channel accounts are asked "Select a sales channel" (AJIO / ZIVAME)
    // after the code. Every automation here is AJIO's, so a driver clicks it.
    interstitials: [{ whenText: "Select a sales channel", clickText: "AJIO" }],
};
