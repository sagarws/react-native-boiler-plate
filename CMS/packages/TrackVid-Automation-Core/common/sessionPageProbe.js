// -----------------------------------------------------------------------------
// "Is this signed in?" — asked from inside the page, for the two that must be
// -----------------------------------------------------------------------------
// common/sessionIdentity and common/probeSession both answer from a JAR: take
// the cookies, make an HTTPS request, read the reply. Two platforms cannot be
// asked that way at all, and both are absent from those registries on purpose:
//
//   ajio      every call goes through a logged-in page because Akamai wants the
//             browser's own TLS fingerprint. The same request from axios is
//             refused however complete the jar is.
//   tatacliq  Cloudflare in front of the portal, and its search is scoped to a
//             SLAVE the session holds server-side — so a bare request cannot
//             reproduce what the browser sees.
//
// Answering "cannot tell" for them is correct and has a cost: a capture window
// that cannot be verified cannot be closed automatically, and cannot be checked
// before it is stored. The operator closes it, and whatever came out is saved.
//
// BUT THE CAPTURE WINDOW IS A BROWSER. The thing those probes need is exactly
// what is already on screen, so the question can be asked there — the same
// `fetch` the core's own `probeSessionInPage` runs, expressed as a SCRIPT so a
// consumer without puppeteer can evaluate it (Trackvid-CMS runs it with
// webContents.executeJavaScript, as it already does for session extras).
//
// ## Contract
//
//   script(extras)  a self-contained JS expression, evaluated in the signed-in
//                   page, resolving to whatever `read` understands. Returns
//                   null when the extras it needs are not there yet — which is
//                   "ask again later", not "signed out".
//   read(value)     true | false | null. NULL IS NOT FALSE: a fetch that threw,
//                   a body that could not be parsed, a page mid-navigation —
//                   none of those are evidence of being signed out, and
//                   treating them as such throws away real sessions.
// -----------------------------------------------------------------------------

const { platformKey } = require("./platforms.js");
const { ORIGIN: TATACLIQ_ORIGIN, parseSlaveList } = require("../platforms/tatacliq/common/slaveSync.js");

/** JSON-safe string literal for embedding in a generated script. */
const literal = (value) => JSON.stringify(String(value));

const PAGE_PROBES = {
    /**
     * Tata CliQ — the slave list, which is what the claim flow needs anyway.
     *
     * The same call `probeSessionInPage` makes. Signed out, the portal answers
     * the login page (or an empty body) and no `<li id="…">` comes back; signed
     * in, it lists the seller's warehouses. Parsed here with the slave sync's
     * own parser rather than a second regex in a string.
     */
    tatacliq: {
        script: () =>
            `(async () => {
                try {
                    const res = await fetch(${literal(
                        `${TATACLIQ_ORIGIN}/faces/jsp/userResponse.jsp?flag=SlavesUnderSeller&Value=`
                    )}, {
                        credentials: "include",
                        headers: { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" }
                    });

                    return res.ok ? { html: await res.text() } : { status: res.status };
                } catch (error) {
                    return { error: String(error && error.message || error) };
                }
            })()`,
        read: (value) => {
            if (!value || typeof value !== "object") return null;
            // A refusal is a statement about the request, not the session: the
            // page may be mid-navigation, or Cloudflare may be interposing.
            if (typeof value.html !== "string") return null;

            return parseSlaveList(value.html).length > 0;
        },
    },

    /**
     * AJIO — the POB list for this seller.
     *
     * Needs `userId`, which AJIO's session extras read from the same page. Until
     * that read lands there is nothing to address the request to, which is a
     * `null` script and not a verdict.
     */
    ajio: {
        script: (extras) => {
            const userId = String((extras && extras.userId) || "").trim();

            if (!userId) return null;

            return `(async () => {
                try {
                    const res = await fetch(${literal(
                        `/malekith/nickfury/v1/sellers/`
                    )} + ${literal(userId)} + ${literal(
                "/work-places?workPlaceType=POB&page=0&size=1"
            )}, {
                        credentials: "include",
                        headers: { Accept: "application/json", "X-Tenant": "AJIO" }
                    });

                    if (!res.ok) return { status: res.status };

                    const body = await res.json();

                    return { ok: true, count: Array.isArray(body && body.content) ? body.content.length : null };
                } catch (error) {
                    return { error: String(error && error.message || error) };
                }
            })()`;
        },
        read: (value) => {
            if (!value || typeof value !== "object") return null;
            // 401/403 is AJIO refusing the SESSION, which is an answer.
            if (value.status === 401 || value.status === 403) return false;
            if (value.ok !== true) return null;

            // A signed-in seller with no POBs is not a signed-out seller, so the
            // answer is the 200 itself. `count` rides along for the log.
            return true;
        },
    },
};

/** Is there an in-page check for this platform? */
const hasPageProbe = (platform) => Boolean(PAGE_PROBES[platformKey(platform)]);

/**
 * The script to evaluate, or null when it cannot be built yet.
 *
 * @param {string} platform
 * @param {Record<string, unknown>} [extras] whatever the capture has read so far
 */
const pageProbeScript = (platform, extras = {}) => {
    const probe = PAGE_PROBES[platformKey(platform)];

    return probe ? probe.script(extras) : null;
};

/**
 * Read what the script resolved to.
 *
 * @returns {true|false|null}
 */
const readPageProbe = (platform, value) => {
    const probe = PAGE_PROBES[platformKey(platform)];

    if (!probe) return null;

    try {
        return probe.read(value);
    } catch (_) {
        return null;
    }
};

module.exports = { PAGE_PROBES, hasPageProbe, pageProbeScript, readPageProbe };
