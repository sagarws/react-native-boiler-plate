// Flipkart — scripted sign-in for the desktop app's session re-capture.
//
// Selectors and sequence lifted from the Selenium login in
// ../claim-management/common/utils.js, which is the authority.
//
// `loginUrl` is https://seller.flipkart.com/, which is a LANDING page, not a
// form: a "Login" button there opens the sign-in modal, and only that modal
// carries input[name="username"]. Without the launcher click the form never
// appears and the sign-in waits out its timeout on marketing copy.
//
// The submit button is scoped to the modal footer for a reason the Selenium
// runner learned the hard way: the landing-page "Login" launcher lingers in the
// DOM after being clicked, and an unscoped match clicks that instead — a click
// that never submits anything.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "flipkart",
    steps: [
        {
            kind: "clickText",
            text: "Login",
            label: "Login launcher (landing)",
            optional: true,
            skipIfSelector: 'input[name="username"]',
        },
        {
            kind: "wait",
            selector: 'input[name="username"]',
            label: "sign-in modal",
            timeoutMs: 45000,
        },
        { kind: "fill", selector: 'input[name="username"]', field: "username" },
        { kind: "fill", selector: 'input[name="password"]', field: "password" },
        { kind: "settle", ms: 800 },
        {
            kind: "click",
            selector: ".login-modal-footer button, form button[type='submit']",
            label: "Login",
        },
    ],
    success: { urlExcludes: ["/login", "/npi/"] },
};
