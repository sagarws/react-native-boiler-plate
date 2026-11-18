// -----------------------------------------------------------------------------
// Per-account Bright Data credential map for Myntra automation.
// -----------------------------------------------------------------------------
// Keys are lowercase account emails; values are { username, password }.
// Consumed by proxyConfig.js::loadBrightDataConfig(accountEmail) — when the
// email is present here, its username/password OVERRIDE the process-wide
// BRIGHTDATA_USERNAME / BRIGHTDATA_PASSWORD env vars for that single account.
// Host/port stay shared (BRIGHTDATA_HOST / BRIGHTDATA_PORT env).
//
// Emails not listed here run WITHOUT a proxy — the browser launches direct on
// the host's current IP. This keeps a brand-new credential from silently
// egressing through a stale env zone or a SHARED pool that wasn't chosen for
// it; opting into Bright Data is now an explicit act of adding the email
// below.
//
// To point one account at a different Bright Data zone or dedicated IP later,
// replace SHARED with a literal `{ username: "...", password: "..." }` object
// for just that email — no other files need to change.
// -----------------------------------------------------------------------------

const SHARED = {
    username: "brd-customer-hl_10987067-zone-isp_proxy1-country-in-ip-185.96.81.146",
    password: "483orpj3lfs6",
};

const SHARED2 = {
    username: "brd-customer-hl_10987067-zone-isp_proxy2-country-in-ip-104.239.15.142",
    password: "r0mmvj0px93o",
};
const SHARED3 = {
    username: "brd-customer-hl_10987067-zone-isp_proxy3-country-in-ip-178.171.103.117",
    password: "d3kp4mp5kc4l",
};

const SHARED4 = {
    username: "brd-customer-hl_10987067-zone-isp_proxy4-country-in-ip-160.20.5.59",
    password: "vibccf4ii9i0",
};
const PROXY_ACCOUNTS = {
    // Arvind lifestyle brand limited
    "harsha.monnappa@arvindfashions.com": SHARED,
    "mp.account10@arvindbrands.co.in": SHARED,
    "amrutha.b@arvindfashions.com": SHARED,
    // WROGN PRIVATE LIMITED
    "usplops@westburykommerce.com": SHARED2,

    // DHVY GLOBAL  PVT LTD
    "northridge0005@gmail.com": SHARED4,
    "Northridgeventures.2024@gmail.com": SHARED4,
    "listing@mozafia.com": SHARED4,

    // [EMAIL_ADDRESS]
    "vikash.kabra@tigc.in": SHARED3

};

function normalizeAccountKey(accountEmail) {
    return accountEmail ? String(accountEmail).toLowerCase().trim() : "";
}

function isProxyAccount(accountEmail) {
    const key = normalizeAccountKey(accountEmail);
    return Boolean(key && PROXY_ACCOUNTS[key]);
}

function getProxyAccountOverride(accountEmail) {
    const key = normalizeAccountKey(accountEmail);
    const entry = key && PROXY_ACCOUNTS[key];
    if (!entry || !entry.username || !entry.password) return null;
    return { username: entry.username, password: entry.password };
}

module.exports = {
    PROXY_ACCOUNTS,
    getProxyAccountOverride,
    isProxyAccount,
};
