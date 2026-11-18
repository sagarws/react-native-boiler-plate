// -----------------------------------------------------------------------------
// Bright Data proxy config + sticky-session manager
// -----------------------------------------------------------------------------
// Goal: let us A/B Myntra logins across (a) direct, (b) one fixed Bright Data
// session, (c) per-account rotating sessions — without touching the claim
// filing workflow.
//
// Switching is driven by PROXY_MODE:
//   - "none"      → buildDriver ignores sessionId and launches direct Chrome
//   - "static"    → reuses BRIGHTDATA_STATIC_SESSION (or "static_1") for all
//   - "rotating"  → derives one sticky session per accountEmail; rotateProxySession()
//                   issues a fresh one on a retry
//
// Authenticated proxies can't be passed via --proxy-server. We generate an MV3
// unpacked extension on disk and load it with --load-extension. The extension
// pins chrome.proxy.settings to the Bright Data endpoint and answers
// onAuthRequired with the username/password.
// -----------------------------------------------------------------------------

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { getProxyAccountOverride, isProxyAccount } = require("./proxyAccounts");
const { isDirectConnection, directConnectionReason } = require("../../../common/networkRoute.js");

// Required only where a proxy is actually created. `proxy-chain` is a server
// dependency; Trackvid-CMS signs in from the operator's own connection and has
// no use for it, and a top-level require made the whole Myntra flow
// unimportable there — the failure being a missing module, not a missing proxy.
const loadProxyChain = () => require("proxy-chain");

const PROXY_MODE = (process.env.PROXY_MODE || "rotating").toLowerCase();

function isProxyEnabled() {
    // A process that has declared itself direct is never proxied, whatever
    // PROXY_MODE says — see common/networkRoute.js. The desktop app is already
    // on a residential IP, which is the thing the proxy exists to borrow.
    if (isDirectConnection()) return false;
    return PROXY_MODE === "static" || PROXY_MODE === "rotating";
}

function loadBrightDataConfig(accountEmail) {
    const host = process.env.BRIGHTDATA_HOST;
    const port = process.env.BRIGHTDATA_PORT;
    // Per-account override (proxyAccounts.js) wins over env — same gateway
    // host/port, per-cred username/password so each account can eventually
    // point at its own dedicated Bright Data zone or IP.
    const override = getProxyAccountOverride(accountEmail);
    const username = (override && override.username) || process.env.BRIGHTDATA_USERNAME;
    const password = (override && override.password) || process.env.BRIGHTDATA_PASSWORD;
    const missing = [];
    if (!host) missing.push("BRIGHTDATA_HOST");
    if (!port) missing.push("BRIGHTDATA_PORT");
    if (!username) missing.push("BRIGHTDATA_USERNAME (or proxyAccounts override)");
    if (!password) missing.push("BRIGHTDATA_PASSWORD (or proxyAccounts override)");
    if (missing.length) {
        throw new Error(`Bright Data env missing: ${missing.join(", ")}`);
    }
    if (accountEmail && override) {
        console.log(`🔐 Bright Data override for ${accountEmail} → username=${username.slice(0, 24)}...`);
    }
    return { host, port: Number(port), username, password };
}

// Bright Data sticky-session usernames look like:
//   brd-customer-hl_xxx-zone-datacenter_proxy1-session-<sessionId>
// If the base username already carries a -session-<x> suffix we swap it; the
// dashboard sometimes hands these out pre-baked.
function buildStickyUsername(baseUsername, sessionId) {
    if (!sessionId) return baseUsername;
    if (/-session-[A-Za-z0-9_]+/.test(baseUsername)) {
        return baseUsername.replace(/-session-[A-Za-z0-9_]+/, `-session-${sessionId}`);
    }
    return `${baseUsername}-session-${sessionId}`;
}

function buildProxyCredentials(sessionId, accountEmail) {
    const base = loadBrightDataConfig(accountEmail);
    return {
        host: base.host,
        port: base.port,
        username: buildStickyUsername(base.username, sessionId),
        password: base.password,
        sessionId: sessionId || null,
    };
}

// Bright Data sticky-session IDs only accept [A-Za-z0-9_]. Email-derived IDs
// have to be sanitised before they go into the username.
function sanitizeSessionPart(value) {
    const cleaned = String(value || "default")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return (cleaned || "default").slice(0, 32);
}

// Session ↔ email mapping is persisted to disk in proxySessions.json so the
// same email lands on the same Bright Data IP across script restarts. The
// session ID itself is *derived from the email text only* — no timestamps,
// no random — so two different emails can never collide (different domains
// or local parts produce different sanitised strings).
const SESSIONS_FILE = path.join(__dirname, "proxySessions.json");

function readSessions() {
    try {
        if (fs.existsSync(SESSIONS_FILE)) {
            return fs.readJsonSync(SESSIONS_FILE);
        }
    } catch (_) {
        // Corrupt or unreadable — start fresh rather than crash the worker.
    }
    return {};
}

function writeSessions(sessions) {
    try {
        fs.writeJsonSync(SESSIONS_FILE, sessions, { spaces: 2 });
    } catch (err) {
        console.warn(`⚠️ Could not persist proxy sessions to ${SESSIONS_FILE}: ${err.message}`);
    }
}

// Deterministic session ID for an email. Includes the full email (local-part
// + domain) so `samir@gmail.com` and `samir@outlook.com` never collide.
function sessionIdFromEmail(email) {
    return sanitizeSessionPart(email);
}

// Each entry in proxySessions.json is `{ sessionId, ip?, updatedAt? }`.
// Older runs wrote plain strings (`"emailKey": "sessionId"`), so this helper
// pulls the sessionId out of either shape. Returns null when the entry is
// missing or malformed.
function getSessionIdFromEntry(entry) {
    if (!entry) return null;
    if (typeof entry === "string") return entry;
    if (typeof entry === "object" && typeof entry.sessionId === "string") {
        return entry.sessionId;
    }
    return null;
}

function getNextProxySession(accountEmail) {
    if (PROXY_MODE === "static") {
        return process.env.BRIGHTDATA_STATIC_SESSION || "static_1";
    }
    const key = String(accountEmail || "default").toLowerCase();
    const sessions = readSessions();
    const existingId = getSessionIdFromEntry(sessions[key]);
    if (existingId) return existingId;
    const sid = sessionIdFromEmail(key);
    // New entries always written in the object shape; ip/updatedAt fill in
    // after the next successful login (via recordSessionIp).
    sessions[key] = { sessionId: sid };
    writeSessions(sessions);
    return sid;
}

// Rotation appends/increments an `_rN` suffix on top of the email-derived ID.
// The base stays deterministic from the email; only the rotation index moves.
// Persisted so the next run skips the IPs that already failed for this email.
// The previously-recorded ip/updatedAt are dropped — they belong to the
// rotated-away session and would be misleading until the new login confirms
// the new exit IP.
function rotateProxySession(accountEmail) {
    const key = String(accountEmail || "default").toLowerCase();
    const sessions = readSessions();
    const currentId = getSessionIdFromEntry(sessions[key]) || sessionIdFromEmail(key);
    const match = currentId.match(/^(.+)_r(\d+)$/);
    const base = match ? match[1] : currentId;
    const next = match ? parseInt(match[2], 10) + 1 : 1;
    const fresh = `${base}_r${next}`;
    sessions[key] = { sessionId: fresh };
    writeSessions(sessions);
    return fresh;
}

// Persist the egress IP observed for this email's current sticky session,
// stamped with an ISO timestamp. Callers should pass the IP returned by
// `getCurrentIp` AFTER the proxy connects, so the IP corresponds to the
// session that's actually being used. No-op if `ip` is falsy.
function recordSessionIp(accountEmail, ip) {
    if (!ip) return;
    const key = String(accountEmail || "default").toLowerCase();
    const sessions = readSessions();
    const existingId = getSessionIdFromEntry(sessions[key]) || sessionIdFromEmail(key);
    sessions[key] = {
        sessionId: existingId,
        ip,
        updatedAt: new Date().toISOString(),
    };
    writeSessions(sessions);
}

// Local relay approach (replaces the MV3 extension). Chrome 130+ tightened
// `--load-extension` security so the previous extension-based proxy auth was
// silently ignored on Chrome 149 — every session ended up egressing through
// the office IP. proxy-chain spins up a tiny anonymous HTTP proxy on
// 127.0.0.1:RANDOM that forwards to the authenticated upstream (Bright Data),
// so Chrome just needs --proxy-server=http://127.0.0.1:PORT with no auth.
//
// One relay is started per driver and torn down via closeLocalAuthProxy().
async function createLocalAuthProxy({ host, port, username, password }) {
    const upstreamUrl =
        `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
        `@${host}:${port}`;
    // proxy-chain returns http://127.0.0.1:RANDOM — Chrome connects to this
    // with no Proxy-Authorization, the relay rewrites the request with Bright
    // Data credentials before sending it upstream.
    const localUrl = await loadProxyChain().anonymizeProxy(upstreamUrl);
    return localUrl;
}

async function closeLocalAuthProxy(localUrl) {
    if (!localUrl) return;
    try { await loadProxyChain().closeAnonymizedProxy(localUrl, true); } catch (_) { /* noop */ }
}

// Legacy MV3 extension path. Kept exported so external callers don't break,
// but buildDriver no longer uses it because Chrome 130+ doesn't reliably
// apply chrome.proxy.settings from an unpacked MV3 extension loaded via
// --load-extension.
async function buildAuthProxyExtension({ host, port, username, password }, tmpRoot) {
    const dir = path.join(
        tmpRoot,
        `bd_proxy_ext_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    );
    await fs.ensureDir(dir);

    const manifest = {
        manifest_version: 3,
        name: "Bright Data Proxy Auth",
        version: "1.0.0",
        permissions: ["proxy", "webRequest", "webRequestAuthProvider", "storage"],
        host_permissions: ["<all_urls>"],
        background: { service_worker: "background.js" },
    };

    const background = `const PROXY_HOST = ${JSON.stringify(host)};
const PROXY_PORT = ${Number(port)};
const PROXY_USERNAME = ${JSON.stringify(username)};
const PROXY_PASSWORD = ${JSON.stringify(password)};

const config = {
    mode: "fixed_servers",
    rules: {
        singleProxy: { scheme: "http", host: PROXY_HOST, port: PROXY_PORT },
        bypassList: ["localhost", "127.0.0.1"]
    }
};

function applyProxy() {
    try { chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {}); } catch (_) {}
}

applyProxy();
chrome.runtime.onInstalled.addListener(applyProxy);
chrome.runtime.onStartup.addListener(applyProxy);

chrome.webRequest.onAuthRequired.addListener(
    () => ({ authCredentials: { username: PROXY_USERNAME, password: PROXY_PASSWORD } }),
    { urls: ["<all_urls>"] },
    ["blocking"]
);
`;

    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    await fs.writeFile(path.join(dir, "background.js"), background);
    return dir;
}

function getExtensionTmpRoot() {
    return path.join(os.tmpdir(), "bd_proxy_exts");
}

module.exports = {
    PROXY_MODE,
    isProxyEnabled,
    isProxyAccount,
    loadBrightDataConfig,
    buildStickyUsername,
    buildProxyCredentials,
    getNextProxySession,
    rotateProxySession,
    recordSessionIp,
    createLocalAuthProxy,
    closeLocalAuthProxy,
    buildAuthProxyExtension,
    getExtensionTmpRoot,
};
