/**
 * The loaded module, or null when none is available.
 *
 * Resolved once and cached, including the null: a missing native module will
 * not appear later in the same process, and retrying makes every call pay for
 * a failed resolution.
 */
export function loadOsInput(): any;
/** True when an OS-level click is possible here. */
export function hasOsInput(): boolean;
/**
 * The error to throw when a click is needed and nothing can perform it.
 * Names the fix, because "robotjs failed to load" told an operator nothing
 * they could act on.
 */
export function osInputUnavailableError(): Error;
export const CANDIDATES: string[];
