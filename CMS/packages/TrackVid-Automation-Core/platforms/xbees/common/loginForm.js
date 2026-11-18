// Xbees — scripted sign-in for the desktop app's session re-capture.
//
// Xbees fronts its portal with Keycloak, whose ids (#username / #password /
// #kc-login) are realm defaults rather than anything Xbees chose — which makes
// them the most stable selectors of any platform here.
//
// Selectors and sequence lifted from loginXbeesApi in
// ../claim-management/api-based-flow/claimApiFlow.js, which is the authority.
// That login gives the bounce 45s, and probes for a "Sign in" launcher only
// when the Keycloak form has not already appeared — some landings redirect
// straight through, others need the click.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "xbees",
    steps: [
        {
            kind: "clickText",
            text: "Sign in",
            label: "Sign in launcher (client portal)",
            optional: true,
            skipIfSelector: "#username",
        },
        {
            kind: "wait",
            selector: "#username",
            label: "Keycloak sign-in form",
            timeoutMs: 45000,
        },
        { kind: "fill", selector: "#username", field: "username" },
        { kind: "fill", selector: "#password", field: "password" },
        { kind: "click", selector: "#kc-login", label: "Sign in" },
    ],
    success: { urlExcludes: ["/auth/realms", "/openid-connect/auth"] },
    failure: { anySelector: ["#input-error", ".kc-feedback-text", ".alert-error"] },
};
