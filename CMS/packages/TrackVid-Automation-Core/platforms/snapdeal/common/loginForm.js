// Snapdeal — scripted sign-in for the desktop app's session re-capture.
//
// Selectors lifted from snapdealLogin in
// ../claim-management/common/utils.js, which is the authority. Four steps, not
// two: the portal asks for the username first, then reveals the password field
// behind a "Login with Password" button.
//
// See common/loginForms.js for the step vocabulary.
module.exports = {
    platform: "snapdeal",
    steps: [
        {
            kind: "clickText",
            text: "Login",
            label: "homepage Login",
            optional: true,
            // Some builds land straight on the form; clicking a launcher that
            // is not there would fail a sign-in already one step further on.
            skipIfSelector: 'input[placeholder="Enter your username"]',
        },
        { kind: "settle", ms: 2000 },
        {
            kind: "wait",
            selector: 'input[placeholder="Enter your username"]',
            label: "sign-in form",
            timeoutMs: 45000,
        },
        { kind: "fill", selector: 'input[placeholder="Enter your username"]', field: "username" },
        { kind: "clickText", text: "Login with Password" },
        { kind: "settle", ms: 2000 },
        { kind: "fill", selector: 'input[placeholder="Please enter password"]', field: "password" },
        { kind: "clickText", text: "Submit Password" },
    ],
    // #nav_24 (Returns) and #nav_26 (Reports) are the two nav items the seller
    // shell renders once signed in. URL sniffing gives false negatives here —
    // Snapdeal routes the dashboard through an Angular hash.
    success: { anySelector: ["#nav_24 a", "#nav_26 a"] },
    // Some accounts are challenged. Recognising it is this; answering it is
    // `otpEntry` below. The desktop app still hands the window to the operator
    // when it cannot read the code itself.
    otp: { anySelector: ["#verify-otp #otp", "#otp"] },
    // The panel reads "Attention! To access this panel you need to validate the
    // OTP", with one six-digit box and a Submit beside it. A driver that can
    // read the mailbox fills these and the sign-in finishes unattended.
    otpEntry: { input: "#otp", submit: "#otp-button" },
};
