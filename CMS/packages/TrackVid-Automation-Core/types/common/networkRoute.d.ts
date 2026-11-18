/**
 * Send this process's traffic straight out, with no upstream proxy.
 *
 * Call once at startup. Idempotent.
 */
export function useDirectConnection(why?: string): void;
/** Restore proxying. Present for tests; production sets this once. */
export function useProxiedConnection(): void;
/** True when traffic must leave from this machine's own IP. */
export function isDirectConnection(): boolean;
/** Why the proxy is off, or null when it is on. */
export function directConnectionReason(): any;
