// -----------------------------------------------------------------------------
// Gmail reader — dynamic IMAP fetch by sender / subject / date / seen flag.
// -----------------------------------------------------------------------------
// Exposes fetchEmails(filters) that returns a Promise<Array<Email>>.
// Filters are all optional; unset filters are ignored.
//
//   Filter          IMAP criterion
//   --------------  -------------------------------------
//   from            ['FROM',    <email or substring>]
//   to              ['TO',      <email or substring>]
//   subject         ['SUBJECT', <substring>]
//   bodyText        ['BODY',    <substring>]
//   since           ['SINCE',   <Date>]
//   before          ['BEFORE',  <Date>]
//   unseenOnly:true 'UNSEEN'
//   seenOnly:true   'SEEN'
//   mailbox         defaults to 'INBOX'
//   limit           max results, default 10 (newest first)
//
// Example (CLI at the bottom of this file):
//   node gmail-reader.js "noreply@brightdata.com" "low balance"
// -----------------------------------------------------------------------------

// Load .env when this file is required outside the main server entry point
// (e.g. via the CLI at the bottom, or from a cron worker that hasn't already
// called dotenv). Safe to call multiple times — dotenv skips vars that are
// already set.
const { loadEnv } = require("./loadEnv");
loadEnv();
// Built on demand, not at import. Throwing at module scope made this file —
// and every module that transitively requires it, which includes Flipkart's
// whole claim flow via getOtp — unimportable wherever Gmail is not configured.
// Trackvid-CMS is exactly that case: it never reads OTP mail, but it does file
// Flipkart claims. The check still fires, just at the point mail is actually
// read, where the message is also more useful.
/**
 * The mailbox to read, from an explicit account or from the environment.
 *
 * EXPLICIT FIRST, environment second. The automation server has one mailbox in
 * its `.env` and always will; the desktop app has no server environment to put
 * one in, and asking it to invent environment variables on an operator's
 * machine would be pretending it is a server. So a caller may hand the account
 * over directly — from the OS keychain, in the desktop's case — and a caller
 * that passes nothing behaves exactly as it always has.
 *
 * @param {{ user?: string, password?: string, host?: string, port?: number }} [account]
 */
function imapConfig(account) {
    const user = account?.user || process.env.GMAIL_IMAP_USER;
    const password = account?.password || process.env.GMAIL_IMAP_PASSWORD;

    if (!user || !password) {
        throw new Error(
            "gmail-reader: no mailbox to read — pass { account: { user, password } }, or set " +
                "GMAIL_IMAP_USER and GMAIL_IMAP_PASSWORD in the environment (.env)"
        );
    }

    return {
        user,
        password,
        host: account?.host || "imap.gmail.com",
        port: account?.port || 993,
        tls: true,
        // See earlier commit: corporate/VPN MITM was rejecting the handshake with
        // DEPTH_ZERO_SELF_SIGNED_CERT. `rejectUnauthorized: false` is the
        // insecure fallback until the network CA is properly trusted.
        tlsOptions: {
            servername: account?.host || "imap.gmail.com",
            rejectUnauthorized: false,
        },
    };
}

// -----------------------------------------------------------------------------
// 🔧 Build IMAP search criteria from user-facing filters
// -----------------------------------------------------------------------------
function buildCriteria(filters = {}) {
    const criteria = [];
    if (filters.from) criteria.push(["FROM", filters.from]);
    if (filters.to) criteria.push(["TO", filters.to]);
    if (filters.subject) criteria.push(["SUBJECT", filters.subject]);
    if (filters.bodyText) criteria.push(["BODY", filters.bodyText]);
    if (filters.since) criteria.push(["SINCE", new Date(filters.since)]);
    if (filters.before) criteria.push(["BEFORE", new Date(filters.before)]);
    if (filters.unseenOnly) criteria.push("UNSEEN");
    if (filters.seenOnly) criteria.push("SEEN");
    // Empty criteria = fetch everything.
    if (criteria.length === 0) criteria.push("ALL");
    return criteria;
}

// -----------------------------------------------------------------------------
// 📩 Main API — Promise-based fetch of matching emails
// -----------------------------------------------------------------------------
/**
 * @param {object} [filters] see the table at the top of this file
 * @param {{ account?: { user: string, password: string, host?: string, port?: number } }} [options]
 *        the mailbox to read. Omit it for the environment's.
 */
function fetchEmails(filters = {}, { account } = {}) {
    const mailbox = filters.mailbox || "INBOX";
    const limit = Number.isFinite(filters.limit) ? filters.limit : 10;
    const criteria = buildCriteria(filters);

    return new Promise((resolve, reject) => {
        const Imap = require("imap");
        const imap = new Imap(imapConfig(account));
        const emails = [];
        let pending = 0;
        let fetchEnded = false;

        const finish = (err) => {
            try { imap.end(); } catch (_) { /* noop */ }
            if (err) reject(err); else resolve(emails);
        };

        imap.once("ready", () => {
            imap.openBox(mailbox, /* readOnly */ true, (openErr) => {
                if (openErr) return finish(openErr);
                imap.search(criteria, (searchErr, uids) => {
                    if (searchErr) return finish(searchErr);
                    if (!uids || uids.length === 0) return finish();

                    // Newest first, capped by limit. IMAP returns UIDs in
                    // ascending order (oldest first), so take the tail.
                    const wanted = uids.slice(-limit).reverse();

                    const f = imap.fetch(wanted, { bodies: "", struct: true });
                    f.on("message", (msg) => {
                        pending++;
                        msg.on("body", (stream) => {
                            const { simpleParser } = require("mailparser");
                            simpleParser(stream, (parseErr, parsed) => {
                                if (parseErr) {
                                    pending--;
                                    if (fetchEnded && pending === 0) finish();
                                    return;
                                }
                                emails.push({
                                    from: parsed.from?.text || "",
                                    to: parsed.to?.text || "",
                                    subject: parsed.subject || "",
                                    date: parsed.date || null,
                                    text: parsed.text || "",
                                    html: parsed.html || "",
                                    messageId: parsed.messageId || "",
                                });
                                pending--;
                                if (fetchEnded && pending === 0) finish();
                            });
                        });
                    });
                    f.once("error", finish);
                    f.once("end", () => {
                        fetchEnded = true;
                        if (pending === 0) finish();
                    });
                });
            });
        });

        imap.once("error", finish);
        imap.connect();
    });
}

module.exports = { fetchEmails, imapConfig };

// -----------------------------------------------------------------------------
// 🎯 Example usage — fetch the "Low balance" Bright Data alert
// -----------------------------------------------------------------------------
// This block only runs when the file is executed directly (not when required).
// Tweak the filters object to fetch any other email; the function accepts any
// combination of from / to / subject / bodyText / since / before / unseenOnly
// / seenOnly / mailbox / limit.
// -----------------------------------------------------------------------------
async function getTataSellerPortalOtpEmail() {
    const results = await fetchEmails({
        from: "sp.alerts@tataunistore.com",
        to: "ppmp.tataunistore@wrogn.com",
        subject: "One Time Password (OTP) for your LOGIN on Seller Portal",
        limit: 1, // newest match only
    });

    if (results.length === 0) {
        console.log("(no matching email found)");
        return null;
    }

    const email = results[0];
    console.log("─".repeat(60));
    console.log("From:    ", email.from);
    console.log("To:      ", email.to);
    console.log("Subject: ", email.subject);
    console.log("Date:    ", email.date?.toISOString?.() || email.date);
    console.log("─".repeat(60));
    console.log(email.text.trim());
    console.log("─".repeat(60));
    return email;
}

if (require.main === module) {
    getTataSellerPortalOtpEmail().catch((err) => {
        console.error("❌ fetchEmails failed:", err);
        process.exitCode = 1;
    });
}



