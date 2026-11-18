// -----------------------------------------------------------------------------
// Meesho — the `browser-id` header, read from the session rather than invented
// -----------------------------------------------------------------------------
// Every request the supplier panel makes carries a `browser-id` header. This
// code did not send it, on the reasoning that it is a per-browser fingerprint
// nothing here has an honest value for — and that inventing one would be worse
// than omitting it. The first half of that was right. The second half was
// wrong, and it cost a fortnight of claims.
//
// THE VALUE IS ALREADY IN THE COOKIE JAR. Captured 2026-09-19 from a claim
// filed by hand that succeeded:
//
//     header   browser-id: <value>
//     cookie   browser_id=<same value, percent-encoded>
//
// They are the same string; the cookie is merely URL-encoded. So the session
// this process already holds carries the fingerprint the header wants, and
// sending it is not inventing anything — it is forwarding what the sign-in was
// given, which is exactly what a browser does.
//
// WHY IT SUDDENLY MATTERED. Claims filed normally for a day or two and then
// failed, every time, with a bare HTTP 500 — while the same seller filing the
// same AWB by hand went through. Nothing changed here, so something changed
// there: `createTicket` began caring about a header that had always been
// optional. That is why the session's own value is used rather than a constant:
// a fingerprint shared by every seller on every machine is the shape of request
// that gets a marketplace's bot rules tightened again.
//
// Absent from the jar, nothing is sent and the call behaves exactly as it did
// before. An older session captured before this was noticed still works, or
// still fails, on its own terms — it is not made worse.
// -----------------------------------------------------------------------------

/**
 * The `browser-id` for this session, or "" when the jar does not carry one.
 *
 * @param {object|Array} jar  the stored cookie jar, in either shape this
 *   package uses: a `{ name: value }` map, or an array of `{ name, value }`.
 * @returns {string}
 */
function browserId(jar) {
    if (!jar) return "";

    let raw = "";

    if (Array.isArray(jar)) {
        const hit = jar.find((cookie) => cookie && cookie.name === "browser_id");

        raw = hit ? String(hit.value ?? "") : "";
    } else if (typeof jar === "object") {
        raw = String(jar.browser_id ?? "");
    }

    if (!raw) return "";

    // Percent-decoded, because that is the difference between the two: the
    // cookie carries "…%3D%3D" where the header carries "…==". Sending the
    // encoded form would be sending a different string.
    try {
        return decodeURIComponent(raw).trim();
    } catch {
        // A value that will not decode is sent as it stands rather than
        // dropped — it is still closer to right than nothing.
        return raw.trim();
    }
}

/** The header, ready to spread — empty when there is nothing to send. */
const browserIdHeader = (jar) => {
    const value = browserId(jar);

    return value ? { "browser-id": value } : {};
};

module.exports = { browserId, browserIdHeader };
