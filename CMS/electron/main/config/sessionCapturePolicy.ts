/**
 * Whether a running process re-captures an expired login itself.
 *
 * `AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true` in .env — inlined at build
 * time by electron.vite.config.ts. On, any process that meets an expired session
 * on a platform whose auto-login is on signs in again by script and carries on:
 * Create Ticket, Auto claim, Refill, imports. Off — the default — those follow
 * the rule that only the session login signs in.
 *
 * A function rather than the bare constant, so tests can answer both ways.
 */
export const autoCaptureOnRunningProcess = (): boolean => __AUTO_SESSION_CAPTURE__
