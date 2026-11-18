// Delhivery — scripted sign-in for the desktop app's session re-capture.
//
// Selectors and sequence lifted from loginDelhiveryApi in
// ../claim-management/api-based-flow/claimApiFlow.js, which is the authority.
//
// The flow is landing → email → Continue → Keycloak password page → Login. The
// "Continue" step is not optional: email and password are on DIFFERENT pages,
// so skipping it means filling a password field that does not exist yet.
//
// Two waits that look like padding and are not:
//   * 4s up front — the email input is in the DOM before the Vue app hydrates,
//     so it is present but not interactable. The Selenium runner sleeps here
//     for the same reason.
//   * `visibleOnly` on the password — Chrome injects a 0x0 hidden password
//     input for autofill on this page, and filling that one submits blank.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "delhivery",
    steps: [
        { kind: "settle", ms: 4000 },
        {
            kind: "wait",
            selector: 'input[name="email"][type="email"]',
            label: "email field",
            timeoutMs: 45000,
        },
        {
            kind: "fill",
            selector: 'input[name="email"][type="email"]',
            field: "username",
        },
        { kind: "settle", ms: 500 },
        { kind: "clickText", text: "Continue", label: "Continue (after email)" },
        {
            kind: "wait",
            selector: 'input[type="password"]',
            label: "Keycloak password page",
            timeoutMs: 45000,
        },
        {
            kind: "fill",
            selector: 'input[type="password"]',
            field: "password",
            visibleOnly: true,
        },
        { kind: "settle", ms: 500 },
        { kind: "clickText", text: "Login" },
    ],
    success: { urlExcludes: ["/login", "/signin", "/auth/realms"] },
};
