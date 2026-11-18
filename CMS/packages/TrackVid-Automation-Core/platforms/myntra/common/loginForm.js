// Myntra — scripted sign-in for the desktop app's session re-capture.
//
// Selectors and sequence lifted from buildDriverAndLogin in
// ../claim-management/common/utils.js, which is the authority.
//
// Three things that page needs and a naive descriptor misses:
//
//   1. `loginUrl` is a LANDING page. A "Login" button opens the flow.
//   2. Then an SSO CHOOSER appears — "Use Email And Password" has to be picked
//      before #email exists at all.
//   3. A long initial pause. The Selenium runner sleeps 6s before touching
//      anything, because submitting before the bot-detection and analytics
//      scripts have bootstrapped surfaces a red "Network Error" banner under
//      LOG IN. That pause is load-bearing, not padding.
//
// That runner also types per character to dodge bot heuristics, which the
// desktop driver cannot reproduce. If Myntra starts rejecting these sign-ins,
// that difference is the first suspect and the manual window is the fallback.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "myntra",
    steps: [
        // See (3) above — before any interaction, not between steps.
        { kind: "settle", ms: 6000 },
        {
            kind: "clickText",
            text: "Login",
            label: "Login launcher (homepage)",
            optional: true,
            skipIfSelector: "#email",
        },
        { kind: "settle", ms: 2500 },
        {
            kind: "clickText",
            text: "Use Email And Password",
            match: "contains",
            label: "SSO chooser",
            optional: true,
            skipIfSelector: "#email",
        },
        { kind: "settle", ms: 2500 },
        { kind: "wait", selector: "#email", label: "sign-in form", timeoutMs: 45000 },
        { kind: "fill", selector: "#email", field: "username" },
        { kind: "settle", ms: 1200 },
        { kind: "fill", selector: "#password", field: "password" },
        { kind: "settle", ms: 2500 },
        { kind: "clickText", text: "LOG IN" },
    ],
    success: { urlExcludes: ["/login", "/signin"] },
};
