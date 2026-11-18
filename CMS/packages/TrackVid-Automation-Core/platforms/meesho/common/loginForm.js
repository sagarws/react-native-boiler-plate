// Meesho — scripted sign-in for the desktop app's session re-capture.
//
// Selectors lifted from loginMeeshoApi in
// ../claim-management/api-based-flow/claimApiFlow.js, which is the authority.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "meesho",
    steps: [
        {
            kind: "click",
            selector: "a#loginbutton",
            label: "Login launcher",
            optional: true,
            skipIfSelector: 'input[name="emailOrPhone"]',
        },
        { kind: "settle", ms: 2000 },
        {
            kind: "wait",
            selector: 'input[name="emailOrPhone"]',
            label: "sign-in form",
            timeoutMs: 45000,
        },
        { kind: "fill", selector: 'input[name="emailOrPhone"]', field: "username" },
        { kind: "fill", selector: 'input[name="password"]', field: "password" },
        { kind: "click", selector: 'button[type="submit"]', label: "Sign in" },
    ],
    // Meesho keeps a failed sign-in on /login, so leaving it is the signal.
    success: { urlExcludes: ["/login"] },
    failure: { anySelector: [".error-message", ".Mui-error"] },
};
