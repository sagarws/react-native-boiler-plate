/**
 * Stop this process writing sessions to the database.
 *
 * Call once at startup. Idempotent.
 *
 * @param {string} [why] recorded so a log line can say why nothing was written
 */
export function disableSessionPersistence(why?: string): void;
/** Re-enable. Present for tests; production code sets this once and leaves it. */
export function enableSessionPersistence(): void;
/**
 * May a session store write?
 *
 * Every platform's `isSessionCacheEnabled` consults this FIRST, before its own
 * env flags — a process that cannot reach the database cannot be overridden
 * into trying by an environment variable.
 */
export function isSessionPersistenceEnabled(): boolean;
/** Why writes are off, or null when they are on. */
export function sessionPersistenceReason(): any;
