/**
 * String normalisers shared by every platform's session store and claim flow.
 *
 * Each of these existed as a per-platform copy that differed only in line
 * wrapping or a lambda parameter name.
 */
/** Credential usernames are matched case-insensitively and trimmed. */
export function normalizeUsername(value: any): string;
/** Loose comparison key: lowercase, non-alphanumerics collapsed to single spaces. */
export function normalizeLoose(value: any): string;
/** Escape a value for safe interpolation into a RegExp. */
export function escapeRegex(value: any): string;
