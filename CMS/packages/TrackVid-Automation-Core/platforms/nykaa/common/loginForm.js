// Nykaa — scripted sign-in for the desktop app's session re-capture.
//
// Nykaa is the odd one: the form is a Zoho IAM widget inside an iframe
// (#iamFrame), so every selector below resolves inside that frame, not the top
// document. `frameSelector` is what tells the driver to switch.
//
// Selectors lifted from getLoginFrame / the login helper in
// ../claim-management/common/utils.js, which is the authority.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "nykaa",
    frameSelector: "#iamFrame",
    steps: [
        // The frame itself has to exist before anything inside it resolves.
        { kind: "wait", selector: "#login_id", label: "Zoho sign-in form", timeoutMs: 45000 },
        { kind: "fill", selector: "#login_id", field: "username" },
        { kind: "click", selector: "#nextbtn", label: "Next" },
        { kind: "wait", selector: "#password", label: "password field" },
        { kind: "settle", ms: 800 },
        { kind: "fill", selector: "#password", field: "password" },
        // Same button, relabelled "Sign in" at this step.
        { kind: "click", selector: "#nextbtn", label: "Sign in" },
    ],
    // On success the PARENT page navigates away from the login route; on
    // failure the iframe stays put and shows an inline error.
    success: { urlExcludes: ["/login", "accounts.zoho"] },
    // Zoho renders this inside the frame with display:block.
    failure: { anySelector: [".fielderror.errorlabel"] },
};
