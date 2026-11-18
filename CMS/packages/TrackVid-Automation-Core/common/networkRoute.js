// -----------------------------------------------------------------------------
// Whose IP does a sign-in come from?
// -----------------------------------------------------------------------------
// The automation server signs in through Bright Data. It has to: a datacentre
// IP signing into a seller portal all day is exactly what these sites flag, so
// the traffic is routed through a residential exit, with a sticky session so the
// login and the API calls that follow share one IP.
//
// The desktop app is the opposite case. It is ALREADY on a residential
// connection — the operator's own — which is the very thing the proxy exists to
// borrow. Routing it through Bright Data would add cost, latency and a relay
// that can fail, to arrive somewhere less trustworthy than where it started.
//
// So: a process-level switch, like common/sessionPersistence.js. Direct is
// something a consumer opts into once at startup, not a decision made per call
// where one site could get it wrong.
//
// It also removes a dependency. `proxy-chain` is a server package; the desktop
// app has no use for it, and a login that never proxies should not need it
// installed to start. Callers check `usesProxy()` before touching the proxy
// helpers at all.
//
// Default is PROXY-ENABLED, so the server behaves exactly as before and a
// consumer that never calls disable is unaffected.
// -----------------------------------------------------------------------------

let direct = false;
let reason = null;

/**
 * Send this process's traffic straight out, with no upstream proxy.
 *
 * Call once at startup. Idempotent.
 */
function useDirectConnection(why = "this process is already on a residential connection") {
    direct = true;
    reason = why;
}

/** Restore proxying. Present for tests; production sets this once. */
function useProxiedConnection() {
    direct = false;
    reason = null;
}

/** True when traffic must leave from this machine's own IP. */
function isDirectConnection() {
    return direct;
}

/** Why the proxy is off, or null when it is on. */
function directConnectionReason() {
    return direct ? reason : null;
}

module.exports = {
    useDirectConnection,
    useProxiedConnection,
    isDirectConnection,
    directConnectionReason,
};
