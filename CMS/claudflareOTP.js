/* eslint-disable -- temporary plain-Node CommonJS script; the repo's lint rules are for the TypeScript app */
// -----------------------------------------------------------------------------
// claudflareOTP.js — TEMPORARY manual check for the Cloudflare Access code that
// guards sellerzone.tatacliq.com. Not part of the app; not bundled.
// -----------------------------------------------------------------------------
// Run from this folder:
//
//   node claudflareOTP.js                      # newest code for jyothi@wrogn.com
//   node claudflareOTP.js someone@wrogn.com    # another mailbox
//   node claudflareOTP.js --wait               # wait up to 2 min for a NEW code
//                                              # (start it, then request a code)
//
// The real reader lives in the core (platforms/tatacliq/common/cloudflareOTP.js);
// this file is a stand-alone copy of its logic so it runs before the CMS's core
// submodule pin has moved. It borrows the core's Gmail reader and poller from
// that submodule.
//
// Mailbox credentials: GMAIL_IMAP_USER / GMAIL_IMAP_PASSWORD, read from the
// shell, then this folder's .env, then ../Automated-Scripts/.env — the CMS's
// own .env does not carry them; the server's does.
// -----------------------------------------------------------------------------

const path = require("path");

const CORE = path.join(__dirname, "packages", "TrackVid-Automation-Core");

/** Fills GMAIL_IMAP_* from the first .env that has them. dotenv never overwrites a set variable. */
const loadMailboxCredentials = () => {
    const dotenv = require("dotenv");
    const candidates = [path.join(__dirname, ".env"), path.join(__dirname, "..", "Automated-Scripts", ".env")];

    for (const file of candidates) {
        if (process.env.GMAIL_IMAP_USER && process.env.GMAIL_IMAP_PASSWORD) break;
        dotenv.config({ path: file, quiet: true });
    }

    if (!process.env.GMAIL_IMAP_USER || !process.env.GMAIL_IMAP_PASSWORD) {
        throw new Error(
            "No mailbox credentials: set GMAIL_IMAP_USER and GMAIL_IMAP_PASSWORD, " +
                `or put them in one of: ${candidates.join(", ")}`
        );
    }
};

loadMailboxCredentials();

const { fetchEmails } = require(path.join(CORE, "common", "gmailReader"));
const { pollForOtp } = require(path.join(CORE, "platforms", "flipkart", "common", "getOtp"));

const SENDER = "noreply@notify.cloudflare.com";
const SUBJECT = "Cloudflare Access login code for sellerzone.tatacliq.com";
const DEFAULT_TO = "jyothi@wrogn.com";

// Anchored on the mail's own phrases so the footer's year or postal code is
// never read as the code. Tags are flattened first: the HTML puts the label
// and the code in separate elements.
const OTP_REGEXES = [/Cloudflare Access code\s*:?\s*(\d{6})\b/i, /login code\s*:?\s*(\d{6})\b/i];

const plainText = (mail) =>
    `${mail.text || ""}\n${mail.html || ""}`
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/\s+/g, " ");

const extractCloudflareOtp = (mail) => {
    const body = plainText(mail || {});

    for (const regex of OTP_REGEXES) {
        const match = body.match(regex);

        if (match) return match[1];
    }

    return null;
};

/** The newest Cloudflare Access code for this mailbox (newer than `since`, if given), or null. */
const GetCloudflareOTP = async (to = DEFAULT_TO, { since } = {}) => {
    const filters = { from: SENDER, to, subject: SUBJECT, limit: 1 };

    if (since) filters.since = since;

    const [mail] = await fetchEmails(filters);

    return mail ? extractCloudflareOtp(mail) : null;
};

const main = async () => {
    const args = process.argv.slice(2);
    const wait = args.includes("--wait");
    const to = args.find((arg) => !arg.startsWith("--")) || DEFAULT_TO;
    const startedAt = new Date();

    console.log(`[cloudflareOTP] mailbox: ${to}`);
    console.log(
        `[cloudflareOTP] mode:    ${wait ? `waiting for a code newer than ${startedAt.toISOString()}` : "newest code"}`
    );

    const otp = wait
        ? await pollForOtp(() => GetCloudflareOTP(to, { since: startedAt }), {
              timeoutMs: 120000,
              intervalMs: 5000,
          })
        : await GetCloudflareOTP(to);

    if (otp) {
        console.log(`[cloudflareOTP] OTP: ${otp}`);
    } else {
        console.log("[cloudflareOTP] no code found");
        process.exitCode = 1;
    }
};

main().catch((err) => {
    console.error("[cloudflareOTP] failed:", err.message);
    process.exitCode = 1;
});
