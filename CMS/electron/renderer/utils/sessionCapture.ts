/**
 * Whether a running action re-captures an expired login itself instead of
 * stopping at the re-capture dialog — `AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS`
 * in .env, inlined at build time. Only for platforms with auto-login on.
 *
 * A function rather than the bare constant, so tests can answer both ways.
 */
export const autoCaptureOnRunningProcess = (): boolean => __AUTO_SESSION_CAPTURE__
