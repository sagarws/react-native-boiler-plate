// -----------------------------------------------------------------------------
// Whether this PROCESS may write a session to the database
// -----------------------------------------------------------------------------
// Every platform's login persists the jar it mints through that platform's
// session store, which writes to Mongo. That is right on the automation server,
// which owns the database.
//
// It is wrong in Trackvid-CMS. The desktop app runs the same logins — the whole
// point of sharing them — but it has no Mongo, must never hold database
// credentials, and ships what it captures to the backend over HTTP instead. A
// login that tried to write would fail on a connection the app should not be
// able to open in the first place.
//
// So this is a property of the PROCESS, not of a call: the desktop app can
// never persist, the server always can. It is set once at startup rather than
// threaded through eight login signatures, because no single call site should
// be able to get it wrong.
//
// Deliberately NOT an environment variable. The server keeps its
// <PLATFORM>_SESSION_CACHE / _SESSION_SAVE flags — those are its operational
// controls — but the desktop app's behaviour comes from company settings and
// explicit calls, never from env. A flag the operator cannot see is not a
// control, it is a trap.
//
// Default is ENABLED, so the server behaves exactly as it did before this
// existed and a consumer that never calls disable is unaffected.
// -----------------------------------------------------------------------------

let enabled = true;
let reason = null;

/**
 * Stop this process writing sessions to the database.
 *
 * Call once at startup. Idempotent.
 *
 * @param {string} [why] recorded so a log line can say why nothing was written
 */
function disableSessionPersistence(why = "this process has no database access") {
    enabled = false;
    reason = why;
}

/** Re-enable. Present for tests; production code sets this once and leaves it. */
function enableSessionPersistence() {
    enabled = true;
    reason = null;
}

/**
 * May a session store write?
 *
 * Every platform's `isSessionCacheEnabled` consults this FIRST, before its own
 * env flags — a process that cannot reach the database cannot be overridden
 * into trying by an environment variable.
 */
function isSessionPersistenceEnabled() {
    return enabled;
}

/** Why writes are off, or null when they are on. */
function sessionPersistenceReason() {
    return enabled ? null : reason;
}

module.exports = {
    disableSessionPersistence,
    enableSessionPersistence,
    isSessionPersistenceEnabled,
    sessionPersistenceReason,
};
