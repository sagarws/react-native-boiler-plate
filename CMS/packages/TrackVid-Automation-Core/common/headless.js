// -----------------------------------------------------------------------------
// Headless or visible?
// -----------------------------------------------------------------------------
// One rule, one place:
//
//   HEADLESS unset      → headless      (the default)
//   HEADLESS="false"    → visible
//   HEADLESS=anything   → headless
//
// <PLATFORM>_HEADLESS overrides it for one platform. A few platforms ignore
// HEADLESS entirely and read only their own key — see INDEPENDENT_HEADLESS.
//
// Only the exact string "false" opens a window. Everything else is headless,
// including "0", "no", "FALSE" and a typo — a browser that appears on someone's
// screen because a value was misspelt is a worse surprise than one that does
// not, and a server has no screen to put it on anyway.
//
// The expression `process.env.HEADLESS !== "false"` was copy-pasted into eight
// files. Identical today, and identical is exactly what stops being true once
// someone edits one of them.
//
// NOT every login can honour this. Myntra's needs a real, visible window: its
// sign-in is completed by an OS-level mouse click at screen coordinates, which
// is the only input Akamai does not distinguish from a human. `requiresDisplay`
// exists so that platform can say so in one line instead of hard-coding `false`
// and leaving the next reader to guess why.
// -----------------------------------------------------------------------------

/**
 * Per-platform override: MYNTRA_HEADLESS, AJIO_HEADLESS, and so on.
 *
 * Myntra is the reason this exists — its sign-in needs a real window while
 * everything else on the same machine can stay hidden — but the rule is the
 * same for every platform rather than a special case for one.
 *
 * Unset falls through to HEADLESS. Same strict parse: only "false" is visible.
 */
function platformOverride(platform) {
    const key = String(platform || "").trim().toUpperCase();

    if (!key) return undefined;

    return process.env[`${key}_HEADLESS`];
}

/**
 * Platforms whose visibility is decided ONLY by their own key.
 *
 * HEADLESS is the machine-wide default — "show me what the automations are
 * doing". Myntra is not that: its window is a working requirement of the
 * sign-in, not something an operator turns on to watch, and it is the one
 * platform that regularly needs a different answer from everything else on the
 * same machine.
 *
 * Falling through to HEADLESS made those two settings interfere: switching the
 * machine to visible for a debugging session also changed Myntra, and turning
 * Myntra off could not be expressed at all without also hiding every other
 * platform. So for anything in this set, HEADLESS is not consulted — only
 * MYNTRA_HEADLESS decides, and unset means headless.
 *
 * A set rather than an `if (platform === "myntra")`, so adding another is one
 * entry and no call site changes.
 */
const INDEPENDENT_HEADLESS = new Set(["myntra"]);

/**
 * Whether this company automates each platform's sign-in.
 *
 * `settings.isAutoLoginOnActiveSession[platform]`, a company setting rather
 * than an environment one:
 *
 *   true   the app signs in by script → the env decides whether anyone watches
 *   false  a PERSON signs in by hand  → the window must be visible, always
 *
 * The second case is not a preference the environment may override. A manual
 * sign-in in a headless browser is a browser nobody can type into: the
 * automation would sit waiting for a login that cannot happen. So auto-login
 * being off pins the browser VISIBLE, whatever HEADLESS says.
 *
 * Empty by default, so a process that never sets a policy behaves exactly as
 * before — the server included.
 */
const autoLoginPolicy = new Map();

/**
 * @param {string} platform
 * @param {boolean} enabled  false = a human signs in, so the window is shown
 */
function setAutoLoginEnabled(platform, enabled) {
    const key = String(platform || "").trim().toLowerCase();

    if (key) autoLoginPolicy.set(key, enabled !== false);
}

/** Forget every policy. For tests, and for a sign-out that changes company. */
function clearAutoLoginPolicy() {
    autoLoginPolicy.clear();
}

/** Does a person have to complete this platform's sign-in themselves? */
function manualLoginRequired(platform) {
    const key = String(platform || "").trim().toLowerCase();

    return key ? autoLoginPolicy.get(key) === false : false;
}

/**
 * True when the browser should run with no visible window.
 *
 * @param {string} [platform] applies that platform's override and policy
 */
function isHeadless(platform) {
    // The company's setting is checked FIRST and the environment cannot
    // override it. Auto-login off means a person completes the sign-in, and
    // they cannot type into a window that was never drawn.
    if (manualLoginRequired(platform)) return false;

    const key = String(platform || "").trim().toLowerCase();
    const own = platformOverride(platform);

    // Independent platforms never fall through to HEADLESS: unset means
    // headless, whatever the machine-wide default says.
    const raw = INDEPENDENT_HEADLESS.has(key) ? own : (own ?? process.env.HEADLESS);

    return raw !== "false";
}

/**
 * Headless setting for one launch.
 *
 * @param {{ requiresDisplay?: boolean, label?: string }} [options]
 *   requiresDisplay  this login cannot work without a visible window; the
 *                    setting is overridden and the reason is logged once,
 *                    because failing invisibly is worse than ignoring a flag.
 */
function resolveHeadless(options = {}) {
    const headless = isHeadless(options.platform);

    if (headless && options.requiresDisplay) {

        console.log(
            `🖥️  ${options.label || "This login"} needs a visible window (OS-level input), ` +
            `so it is running headed despite HEADLESS.`
        );
        return false;
    }

    return headless;
}

module.exports = {
    isHeadless,
    resolveHeadless,
    setAutoLoginEnabled,
    clearAutoLoginPolicy,
    manualLoginRequired,
};
